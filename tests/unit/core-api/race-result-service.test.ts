import { RaceResultStatus, Sport } from '@poolmaster/shared/domain';
import {
  RaceResultService,
  type RaceResultRowInput,
} from '../../../packages/core-api/src/modules/scoring-families/finish-position/race-result-service';
import { eventStoresRaceResults } from '../../../packages/core-api/src/modules/scoring-families/race-results';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// The admin's finishing order against an in-memory store (#622): what a preview reports, that an
// apply is all or none, how a correction merges, and the standings an apply leaves behind. The
// Prisma adapter's writes against Postgres are in race-results.integration.

const NOW = new Date('2026-05-02T22:30:00.000Z');

function setup(sport: Sport = Sport.HORSE_RACING) {
  const store = new InMemorySportEvents();
  const sportRow = store.addSport(sport);
  const event = store.addEvent({ sport, providerId: 'manual-admin' });
  const [arrow, bolt, comet] = ['Arrow', 'Bolt', 'Comet'].map((name) => {
    const participant = store.addParticipant(sportRow.id, name);
    return store.addToField(event.id, participant.id);
  });
  const scratchedHorse = store.addParticipant(sportRow.id, 'Drift');
  const scratched = store.addToField(event.id, scratchedHorse.id, { isActive: false });
  const service = new RaceResultService({
    events: store.sportEventRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    raceResults: store.raceResultRepo(),
    storesRaceResults: eventStoresRaceResults,
    now: () => NOW,
  });
  return { store, service, event, arrow, bolt, comet, scratched };
}

function row(playerName: string, finishPosition: number | null, overrides: Partial<RaceResultRowInput> = {}): RaceResultRowInput {
  return {
    playerName,
    resultStatus: RaceResultStatus.FINISHED,
    finishPosition,
    startPosition: null,
    riderName: null,
    ...overrides,
  };
}

const FULL_ORDER = [row('Arrow', 1), row('Bolt', 2), row('Comet', 3)];

describe('RaceResultService — events of another scoring family', () => {
  it('refuses preview and apply for a golf event with 422 EVENT_SCORING_FAMILY_MISMATCH, storing no result', async () => {
    const { store, service, event } = setup(Sport.GOLF);
    const mismatch = { code: 'EVENT_SCORING_FAMILY_MISMATCH', statusCode: 422 };

    await expect(service.previewResults(event.id, { isOfficial: false, rows: FULL_ORDER })).rejects.toMatchObject(mismatch);
    await expect(service.applyResults(event.id, { isOfficial: false, rows: FULL_ORDER })).rejects.toMatchObject(mismatch);
    expect(store.raceResultRows).toEqual([]);
  });
});

describe('RaceResultService — preview', () => {
  it('resolves rows within the field and reports CREATE, UPDATE or UNCHANGED against what is stored', async () => {
    const { service, event } = setup();
    await service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Bolt', 2)] });

    const preview = await service.previewResults(event.id, {
      isOfficial: false,
      rows: [row('arrow', 1), row('Bolt', 3), row('Comet', 2), row('Nobody', 4)],
    });

    expect(preview.rows.map((entry) => [entry.resolution, entry.participantName, entry.change])).toEqual([
      ['MATCHED', 'Arrow', 'UNCHANGED'],
      ['MATCHED', 'Bolt', 'UPDATE'],
      ['MATCHED', 'Comet', 'CREATE'],
      ['UNRESOLVED', null, null],
    ]);
    expect(preview.orderErrors).toEqual([]);
  });

  it('writes nothing, however valid the rows', async () => {
    const { store, service, event } = setup();
    await service.previewResults(event.id, { isOfficial: true, rows: FULL_ORDER });
    expect(store.raceResultRows).toEqual([]);
    expect(store.standingRows).toEqual([]);
  });

  it('flags a runner named twice as DUPLICATE_PARTICIPANT on both rows, neither applicable', async () => {
    const { service, event } = setup();
    const preview = await service.previewResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Arrow', 2)] });
    expect(preview.rows.map((entry) => [entry.rowError, entry.change])).toEqual([
      ['DUPLICATE_PARTICIPANT', null],
      ['DUPLICATE_PARTICIPANT', null],
    ]);
  });

  it('flags a place on a runner that did not finish as POSITION_WITHOUT_FINISH', async () => {
    const { service, event } = setup();
    const preview = await service.previewResults(event.id, {
      isOfficial: false,
      rows: [row('Arrow', 1, { resultStatus: RaceResultStatus.DISQUALIFIED })],
    });
    expect(preview.rows[0].rowError).toBe('POSITION_WITHOUT_FINISH');
  });

  it('flags a finisher without a place as FINISH_WITHOUT_POSITION only when the result is official', async () => {
    const { service, event } = setup();
    const provisional = await service.previewResults(event.id, { isOfficial: false, rows: [row('Arrow', null)] });
    const official = await service.previewResults(event.id, { isOfficial: true, rows: [row('Arrow', null)] });
    expect(provisional.rows[0].rowError).toBeNull();
    expect(official.rows[0].rowError).toBe('FINISH_WITHOUT_POSITION');
  });

  it('reports POSITIONS_INVALID for places with a gap, judged together with the stored places of runners not named', async () => {
    const { service, event } = setup();
    await service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1)] });

    const gap = await service.previewResults(event.id, { isOfficial: false, rows: [row('Bolt', 3)] });
    const fills = await service.previewResults(event.id, { isOfficial: false, rows: [row('Bolt', 2)] });
    expect(gap.orderErrors).toEqual(['POSITIONS_INVALID']);
    expect(fills.orderErrors).toEqual([]);
  });

  it('reports FIELD_INCOMPLETE for an official result that leaves an active runner without one, but not a scratched runner', async () => {
    const { service, event } = setup();
    const missingComet = await service.previewResults(event.id, { isOfficial: true, rows: [row('Arrow', 1), row('Bolt', 2)] });
    const wholeField = await service.previewResults(event.id, { isOfficial: true, rows: FULL_ORDER });
    expect(missingComet.orderErrors).toEqual(['FIELD_INCOMPLETE']);
    expect(wholeField.orderErrors).toEqual([]);
  });
});

describe('RaceResultService — apply', () => {
  it('stores every value as sent, sets the official flag on the whole race, and writes each runner\'s standing', async () => {
    const { store, service, event, arrow, bolt, comet } = setup();
    await service.applyResults(event.id, {
      isOfficial: true,
      rows: [
        row('Arrow', 1, { startPosition: 4, riderName: 'J. Velez' }),
        row('Bolt', null, { resultStatus: RaceResultStatus.DISQUALIFIED }),
        row('Comet', 2),
      ],
    });

    const results = await store.raceResultRepo().findBySportEvent(event.id);
    expect(results.map((result) => [result.sportEventParticipantId, result.resultStatus, result.finishPosition, result.startPosition, result.riderName, result.isOfficial]))
      .toEqual(expect.arrayContaining([
        [arrow.id, 'FINISHED', 1, 4, 'J. Velez', true],
        [bolt.id, 'DISQUALIFIED', null, null, null, true],
        [comet.id, 'FINISHED', 2, null, null, true],
      ]));
    expect(store.standingRows.map((standing) => [standing.sportEventParticipantId, standing.position, standing.displayPosition, standing.status, standing.asOf]))
      .toEqual(expect.arrayContaining([
        [arrow.id, 1, '1', 'COMPLETE', NOW],
        [bolt.id, null, null, 'COMPLETE', NOW],
        [comet.id, 2, '2', 'COMPLETE', NOW],
      ]));
  });

  it('shows runners in a dead heat as sharing a "T" place on their standings', async () => {
    const { store, service, event, arrow, bolt, comet } = setup();
    await service.applyResults(event.id, { isOfficial: true, rows: [row('Arrow', 1), row('Bolt', 1), row('Comet', 3)] });
    const display = Object.fromEntries(store.standingRows.map((standing) => [standing.sportEventParticipantId, standing.displayPosition]));
    expect(display).toEqual({ [arrow.id]: 'T1', [bolt.id]: 'T1', [comet.id]: '3' });
  });

  it('marks a runner that did not start withdrawn from the event on its standing', async () => {
    const { store, service, event, comet } = setup();
    await service.applyResults(event.id, {
      isOfficial: true,
      rows: [row('Arrow', 1), row('Bolt', 2), row('Comet', null, { resultStatus: RaceResultStatus.DID_NOT_START })],
    });
    expect(store.standingRows.find((standing) => standing.sportEventParticipantId === comet.id)?.status).toBe('WITHDRAWN');
  });

  it('corrects one runner with a one-row apply, keeping every other stored result and re-deriving shared places', async () => {
    const { store, service, event, arrow, bolt, comet } = setup();
    await service.applyResults(event.id, { isOfficial: true, rows: FULL_ORDER });
    // Stewards place Comet level with Bolt: 1, 2, 2.
    await service.applyResults(event.id, { isOfficial: true, rows: [row('Comet', 2)] });

    const results = await store.raceResultRepo().findBySportEvent(event.id);
    expect(Object.fromEntries(results.map((result) => [result.sportEventParticipantId, result.finishPosition])))
      .toEqual({ [arrow.id]: 1, [bolt.id]: 2, [comet.id]: 2 });
    const display = Object.fromEntries(store.standingRows.map((standing) => [standing.sportEventParticipantId, standing.displayPosition]));
    expect(display).toEqual({ [arrow.id]: '1', [bolt.id]: 'T2', [comet.id]: 'T2' });
  });

  it('withdraws official status from the whole race when a later apply is sent as unofficial', async () => {
    const { store, service, event } = setup();
    await service.applyResults(event.id, { isOfficial: true, rows: FULL_ORDER });
    await service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1)] });
    expect(store.raceResultRows.map((result) => result.isOfficial)).toEqual([false, false, false]);
  });

  it('refuses a row that does not resolve with 422 RACE_RESULT_ROWS_INVALID, storing nothing', async () => {
    const { store, service, event } = setup();
    await expect(service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Nobody', 2)] }))
      .rejects.toMatchObject({ code: 'RACE_RESULT_ROWS_INVALID', statusCode: 422 });
    expect(store.raceResultRows).toEqual([]);
  });

  it('refuses a row error with 422 RACE_RESULT_ROWS_INVALID, storing nothing', async () => {
    const { store, service, event } = setup();
    await expect(service.applyResults(event.id, {
      isOfficial: false,
      rows: [row('Arrow', 1), row('Bolt', 2, { resultStatus: RaceResultStatus.DID_NOT_FINISH })],
    })).rejects.toMatchObject({ code: 'RACE_RESULT_ROWS_INVALID', statusCode: 422 });
    expect(store.raceResultRows).toEqual([]);
  });

  it('refuses places that are not a finishing order with 422 RACE_RESULT_POSITIONS_INVALID, storing nothing', async () => {
    const { store, service, event } = setup();
    await expect(service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Bolt', 2), row('Comet', 2), row('Drift', 3)] }))
      .rejects.toMatchObject({ code: 'RACE_RESULT_POSITIONS_INVALID', statusCode: 422 });
    expect(store.raceResultRows).toEqual([]);
  });

  it('refuses an official result missing an active runner with 422 RACE_RESULT_FIELD_INCOMPLETE, storing nothing', async () => {
    const { store, service, event } = setup();
    await expect(service.applyResults(event.id, { isOfficial: true, rows: [row('Arrow', 1), row('Bolt', 2)] }))
      .rejects.toMatchObject({ code: 'RACE_RESULT_FIELD_INCOMPLETE', statusCode: 422 });
    expect(store.raceResultRows).toEqual([]);
  });

  it('refuses making a provisional result official while a stored finisher has no place, with 422 RACE_RESULT_FIELD_INCOMPLETE', async () => {
    const { store, service, event } = setup();
    await service.applyResults(event.id, { isOfficial: false, rows: [row('Arrow', 1), row('Bolt', null), row('Comet', 2)] });
    await expect(service.applyResults(event.id, { isOfficial: true, rows: [row('Arrow', 1)] }))
      .rejects.toMatchObject({ code: 'RACE_RESULT_FIELD_INCOMPLETE', statusCode: 422 });
    expect(store.raceResultRows.every((result) => !result.isOfficial)).toBe(true);
  });

  it('takes a result for a scratched runner, so an admin can record it as not starting', async () => {
    const { store, service, event, scratched } = setup();
    await service.applyResults(event.id, {
      isOfficial: true,
      rows: [...FULL_ORDER, row('Drift', null, { resultStatus: RaceResultStatus.DID_NOT_START })],
    });
    expect(store.raceResultRows.find((result) => result.sportEventParticipantId === scratched.id)?.resultStatus).toBe('DID_NOT_START');
  });
});
