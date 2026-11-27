import { testDomainEvents } from '../../support/domain-events';
import { GameSideStatus, MatchStatus, Sport, SportEventParticipantStatus } from '@poolmaster/shared/domain';
import {
  RaceResultService,
  type RaceResultRowInput,
} from '../../../packages/core-api/src/modules/scoring-families/finish-position/race-result-service';
import { eventStoresRaceResults } from '../../../packages/core-api/src/modules/scoring-families/race-results';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { RecordingDomainEvents } from '../../support/recording-domain-events';
import { slotStatusRefreshJob } from '../../support/slot-tiebreaker-jobs';

/** A test participant's id, fixed by its name, so a row names it by id as the feed does (#2114). */
const idOf = (name: string): string => `participant-${name.toLowerCase().replace(/\s+/g, '-')}`;

// The admin's finishing order against an in-memory store (#622): what a preview reports, that an
// apply is all or none, how a correction merges, and the standings an apply leaves behind. The
// Prisma adapter's writes against Postgres are in race-results.integration.

const NOW = new Date('2026-05-02T22:30:00.000Z');

async function setup(sport: Sport = Sport.HORSE_RACING) {
  const store = new InMemorySportEvents();
  const sportRow = store.addSport(sport);
  const event = store.addEvent({ sport });
  // A race is its event's round 1 (#2008).
  await store.addRounds(event.id, [{ roundNumber: 1, scheduledDate: NOW }]);
  const [arrow, bolt, comet] = ['Arrow', 'Bolt', 'Comet'].map((name) => {
    const participant = store.addParticipant(sportRow.id, name, { id: idOf(name) });
    return store.addToField(event.id, participant.id);
  });
  const scratchedHorse = store.addParticipant(sportRow.id, 'Drift', { id: idOf('Drift') });
  const scratched = store.addToField(event.id, scratchedHorse.id, { status: SportEventParticipantStatus.WITHDRAWN });
  const domainEvents = new RecordingDomainEvents();
  const service = new RaceResultService({
    events: store.sportEventRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(), mappings: store.mappingRepo(),
    fieldGames: store.fieldGameRepo(),
    storesRaceResults: eventStoresRaceResults,
    domainEvents,
    now: () => NOW,
  });
  return { store, service, event, arrow, bolt, comet, scratched, domainEvents };
}

function row(name: string, finishPosition: number | null, overrides: Partial<RaceResultRowInput> = {}): RaceResultRowInput {
  return {
    participantId: idOf(name),
    resultStatus: GameSideStatus.FINISHED,
    finishPosition,
    startPosition: null,
    ...overrides,
  };
}

const FULL_ORDER = [row('Arrow', 1), row('Bolt', 2), row('Comet', 3)];

describe('RaceResultService — events of another scoring family', () => {
  it('refuses preview and apply for a golf event with 422 EVENT_SCORING_FAMILY_MISMATCH, storing no result', async () => {
    const { store, service, event } = await setup(Sport.GOLF);
    const mismatch = { code: 'EVENT_SCORING_FAMILY_MISMATCH', statusCode: 422 };

    await expect(service.previewResults(event.id, { isOfficial: false, rows: FULL_ORDER })).rejects.toMatchObject(mismatch);
    await expect(service.applyResults(event.id, { isOfficial: false, rows: FULL_ORDER })).rejects.toMatchObject(mismatch);
    expect(store.fieldSideRows).toEqual([]);
  });
});

describe('RaceResultService — preview', () => {
  it('resolves rows within the field and reports CREATE, UPDATE or UNCHANGED against what is stored', async () => {
    const { service, event } = await setup();
    await service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Bolt', 2)] });

    const preview = await service.previewResults(event.id, {
      isOfficial: false,
      rows: [row('Arrow', 1), row('Bolt', 3), row('Comet', 2), row('Nobody', 4)],
    });

    expect(preview.rows.map((entry) => [entry.resolution, entry.participantName, entry.change])).toEqual([
      ['MATCHED', 'Arrow', 'UNCHANGED'],
      ['MATCHED', 'Bolt', 'UPDATE'],
      ['MATCHED', 'Comet', 'CREATE'],
      ['UNRESOLVED', null, null],
    ]);
    expect(preview.orderErrors).toEqual([]);
  });

  it('takes only the race round\'s side results with a status as stored results, so a runner with a side and no result yet previews as CREATE', async () => {
    const { store, service, event, arrow, bolt } = await setup();
    const side = (sportEventParticipantId: string, status: GameSideStatus | null) => ({ sportEventParticipantId, status, position: null, startPosition: null, score: null, scoreToPar: null, periodsCompleted: null });
    await store.addRounds(event.id, [{ roundNumber: 2, scheduledDate: NOW }]);
    await store.fieldGameRepo().applyResults(event.id, {
      games: [
        { roundNumber: 1, status: MatchStatus.IN_PROGRESS, completedAt: null, sides: [side(arrow.id, null)] },
        { roundNumber: 2, status: MatchStatus.COMPLETED, completedAt: NOW, sides: [side(bolt.id, GameSideStatus.FINISHED)] },
      ],
      standings: [],
    });

    const preview = await service.previewResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Bolt', 2)] });

    expect(preview.rows.map((entry) => [entry.participantName, entry.change, entry.before])).toEqual([['Arrow', 'CREATE', null], ['Bolt', 'CREATE', null]]);
  });

  it('writes nothing, however valid the rows', async () => {
    const { store, service, event } = await setup();
    await service.previewResults(event.id, { isOfficial: true, rows: FULL_ORDER });
    expect(store.fieldSideRows).toEqual([]);
    expect(store.standingRows).toEqual([]);
  });

  it('flags a runner named twice as DUPLICATE_PARTICIPANT on both rows, neither applicable', async () => {
    const { service, event } = await setup();
    const preview = await service.previewResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Arrow', 2)] });
    expect(preview.rows.map((entry) => [entry.rowError, entry.change])).toEqual([
      ['DUPLICATE_PARTICIPANT', null],
      ['DUPLICATE_PARTICIPANT', null],
    ]);
  });

  it('flags a place on a runner that did not finish as POSITION_WITHOUT_FINISH', async () => {
    const { service, event } = await setup();
    const preview = await service.previewResults(event.id, {
      isOfficial: false,
      rows: [row('Arrow', 1, { resultStatus: GameSideStatus.DISQUALIFIED })],
    });
    expect(preview.rows[0].rowError).toBe('POSITION_WITHOUT_FINISH');
  });

  it('flags a finisher without a place as FINISH_WITHOUT_POSITION only when the result is official', async () => {
    const { service, event } = await setup();
    const provisional = await service.previewResults(event.id, { isOfficial: false, rows: [row('Arrow', null)] });
    const official = await service.previewResults(event.id, { isOfficial: true, rows: [row('Arrow', null)] });
    expect(provisional.rows[0].rowError).toBeNull();
    expect(official.rows[0].rowError).toBe('FINISH_WITHOUT_POSITION');
  });

  it('reports POSITIONS_INVALID for places with a gap, judged together with the stored places of runners not named', async () => {
    const { service, event } = await setup();
    await service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1)] });

    const gap = await service.previewResults(event.id, { isOfficial: false, rows: [row('Bolt', 3)] });
    const fills = await service.previewResults(event.id, { isOfficial: false, rows: [row('Bolt', 2)] });
    expect(gap.orderErrors).toEqual(['POSITIONS_INVALID']);
    expect(fills.orderErrors).toEqual([]);
  });

  it('reports FIELD_INCOMPLETE for an official result that leaves an active runner without one, but not a scratched runner', async () => {
    const { service, event } = await setup();
    const missingComet = await service.previewResults(event.id, { isOfficial: true, rows: [row('Arrow', 1), row('Bolt', 2)] });
    const wholeField = await service.previewResults(event.id, { isOfficial: true, rows: FULL_ORDER });
    expect(missingComet.orderErrors).toEqual(['FIELD_INCOMPLETE']);
    expect(wholeField.orderErrors).toEqual([]);
  });
});

describe('RaceResultService — apply', () => {
  it('stores every value as sent, sets the official flag on the whole race, and writes each runner\'s standing', async () => {
    const { store, service, event, arrow, bolt, comet } = await setup();
    await service.applyResults(event.id, {
      isOfficial: true,
      rows: [
        row('Arrow', 1, { startPosition: 4 }),
        row('Bolt', null, { resultStatus: GameSideStatus.DISQUALIFIED }),
        row('Comet', 2),
      ],
    });

    const results = await store.fieldGameRepo().findResults(event.id);
    expect(results.map((result) => [result.sportEventParticipantId, result.status, result.position, result.startPosition, result.gameStatus === 'COMPLETED']))
      .toEqual(expect.arrayContaining([
        [arrow.id, 'FINISHED', 1, 4, true],
        [bolt.id, 'DISQUALIFIED', null, null, true],
        [comet.id, 'FINISHED', 2, null, true],
      ]));
    expect(store.standingRows.map((standing) => [standing.sportEventParticipantId, standing.position, standing.displayPosition, standing.status, standing.asOf]))
      .toEqual(expect.arrayContaining([
        [arrow.id, 1, '1', 'COMPLETE', NOW],
        [bolt.id, null, null, 'COMPLETE', NOW],
        [comet.id, 2, '2', 'COMPLETE', NOW],
      ]));
  });

  it('shows runners in a dead heat as sharing a "T" place on their standings', async () => {
    const { store, service, event, arrow, bolt, comet } = await setup();
    await service.applyResults(event.id, { isOfficial: true, rows: [row('Arrow', 1), row('Bolt', 1), row('Comet', 3)] });
    const display = Object.fromEntries(store.standingRows.map((standing) => [standing.sportEventParticipantId, standing.displayPosition]));
    expect(display).toEqual({ [arrow.id]: 'T1', [bolt.id]: 'T1', [comet.id]: '3' });
  });

  it('marks a runner that did not start withdrawn from the event on its standing', async () => {
    const { store, service, event, comet } = await setup();
    await service.applyResults(event.id, {
      isOfficial: true,
      rows: [row('Arrow', 1), row('Bolt', 2), row('Comet', null, { resultStatus: GameSideStatus.DID_NOT_START })],
    });
    expect(store.standingRows.find((standing) => standing.sportEventParticipantId === comet.id)?.status).toBe('WITHDRAWN');
  });

  it('corrects one runner with a one-row apply, keeping every other stored result and re-deriving shared places', async () => {
    const { store, service, event, arrow, bolt, comet } = await setup();
    await service.applyResults(event.id, { isOfficial: true, rows: FULL_ORDER });
    // Stewards place Comet level with Bolt: 1, 2, 2.
    await service.applyResults(event.id, { isOfficial: true, rows: [row('Comet', 2)] });

    const results = await store.fieldGameRepo().findResults(event.id);
    expect(Object.fromEntries(results.map((result) => [result.sportEventParticipantId, result.position])))
      .toEqual({ [arrow.id]: 1, [bolt.id]: 2, [comet.id]: 2 });
    const display = Object.fromEntries(store.standingRows.map((standing) => [standing.sportEventParticipantId, standing.displayPosition]));
    expect(display).toEqual({ [arrow.id]: '1', [bolt.id]: 'T2', [comet.id]: 'T2' });
  });

  it('withdraws official status from the whole race when a later apply is sent as unofficial', async () => {
    const { store, service, event } = await setup();
    await service.applyResults(event.id, { isOfficial: true, rows: FULL_ORDER });
    await service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1)] });
    expect(store.fieldSideRows.map((result) => result.gameStatus === 'COMPLETED')).toEqual([false, false, false]);
  });

  it('refuses a row that does not resolve with 422 RACE_RESULT_ROWS_INVALID, storing nothing', async () => {
    const { store, service, event } = await setup();
    await expect(service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Nobody', 2)] }))
      .rejects.toMatchObject({ code: 'RACE_RESULT_ROWS_INVALID', statusCode: 422 });
    expect(store.fieldSideRows).toEqual([]);
  });

  it('refuses a row error with 422 RACE_RESULT_ROWS_INVALID, storing nothing', async () => {
    const { store, service, event } = await setup();
    await expect(service.applyResults(event.id, {
      isOfficial: false,
      rows: [row('Arrow', 1), row('Bolt', 2, { resultStatus: GameSideStatus.DID_NOT_FINISH })],
    })).rejects.toMatchObject({ code: 'RACE_RESULT_ROWS_INVALID', statusCode: 422 });
    expect(store.fieldSideRows).toEqual([]);
  });

  it('refuses places that are not a finishing order with 422 RACE_RESULT_POSITIONS_INVALID, storing nothing', async () => {
    const { store, service, event } = await setup();
    await expect(service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Bolt', 2), row('Comet', 2), row('Drift', 3)] }))
      .rejects.toMatchObject({ code: 'RACE_RESULT_POSITIONS_INVALID', statusCode: 422 });
    expect(store.fieldSideRows).toEqual([]);
  });

  it('refuses an official result missing an active runner with 422 RACE_RESULT_FIELD_INCOMPLETE, storing nothing', async () => {
    const { store, service, event } = await setup();
    await expect(service.applyResults(event.id, { isOfficial: true, rows: [row('Arrow', 1), row('Bolt', 2)] }))
      .rejects.toMatchObject({ code: 'RACE_RESULT_FIELD_INCOMPLETE', statusCode: 422 });
    expect(store.fieldSideRows).toEqual([]);
  });

  it('refuses making a provisional result official while a stored finisher has no place, with 422 RACE_RESULT_FIELD_INCOMPLETE', async () => {
    const { store, service, event } = await setup();
    await service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Bolt', null), row('Comet', 2)] });
    await expect(service.applyResults(event.id, { isOfficial: true, rows: [row('Arrow', 1)] }))
      .rejects.toMatchObject({ code: 'RACE_RESULT_FIELD_INCOMPLETE', statusCode: 422 });
    expect(store.fieldSideRows.every((result) => result.gameStatus !== 'COMPLETED')).toBe(true);
  });

  it('takes a result for a scratched runner, so an admin can record it as not starting', async () => {
    const { store, service, event, scratched } = await setup();
    await service.applyResults(event.id, {
      isOfficial: true,
      rows: [...FULL_ORDER, row('Drift', null, { resultStatus: GameSideStatus.DID_NOT_START })],
    });
    expect(store.fieldSideRows.find((result) => result.sportEventParticipantId === scratched.id)?.status).toBe('DID_NOT_START');
  });
});

describe('RaceResultService — clock', () => {
  it('stamps the standings an apply writes with the current time when it has no clock of its own', async () => {
    const { store, event } = await setup();
    const service = new RaceResultService({ domainEvents: testDomainEvents(),
      events: store.sportEventRepo(),
      field: store.fieldRepo(),
      participants: store.participantRepo(), mappings: store.mappingRepo(),
      fieldGames: store.fieldGameRepo(),
      storesRaceResults: eventStoresRaceResults,
    });
    const before = Date.now();

    await service.applyResults(event.id, { isOfficial: true, rows: FULL_ORDER });

    const stamps = store.standingRows.map((row) => row.asOf?.getTime() ?? 0);
    expect(stamps.length).toBeGreaterThan(0);
    expect(stamps.every((stamp) => stamp >= before && stamp <= Date.now())).toBe(true);
  });
});

describe('RaceResultService — leaderboard rebuild (#1466)', () => {
  it('writes the event\'s leaderboard rebuild job with the finishing order and wakes the runner after it', async () => {
    const { store, service, event, domainEvents } = await setup();

    await service.applyResults(event.id, { isOfficial: true, rows: FULL_ORDER });

    // The race's Game moved, so its slot's status is refreshed with it (#2013).
    expect(store.backgroundJobs).toEqual([eventRebuildJob(event.id), slotStatusRefreshJob(event.id)]);
    expect(domainEvents.changedSportEventIds).toEqual([event.id]);
  });

  it('hands out no rebuild for an order refused before anything is written', async () => {
    const { store, service, event, domainEvents } = await setup(Sport.GOLF);

    await expect(service.applyResults(event.id, { isOfficial: true, rows: FULL_ORDER })).rejects.toMatchObject({ code: 'EVENT_SCORING_FAMILY_MISMATCH' });
    expect(store.backgroundJobs).toEqual([]);
    expect(domainEvents.changedSportEventIds).toEqual([]);
  });
});
