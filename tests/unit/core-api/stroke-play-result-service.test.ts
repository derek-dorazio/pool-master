import { sportPlay } from '../../support/sport-play';
import { testDomainEvents } from '../../support/domain-events';
import { PeriodUnit, Sport } from '@poolmaster/shared/domain';
import { StrokePlayResultService } from '../../../packages/core-api/src/modules/scoring-families/stroke-play/stroke-play-result-service';
import { eventStoresGolfRoundScores } from '../../../packages/core-api/src/modules/scoring-families/golf-round-scores';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { fakeLogger } from '../../support/fake-logger';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { RecordingDomainEvents } from '../../support/recording-domain-events';
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { slotStatusRefreshJob } from '../../support/slot-tiebreaker-jobs';

/** A test participant's id, fixed by its name, so a row names it by id as the feed does (#2114). */
const idOf = (name: string): string => `participant-${name.toLowerCase().replace(/\s+/g, '-')}`;

// Stroke-play results against an in-memory store (#2008): a golfer's round is their side result in
// the round's FIELD Game, and their standing carries the event totals and the rank. What a preview
// reports, that apply is all or none, how a correction merges, how a standing is totalled and
// ranked, and what the sync writes. The writes against Postgres are in golf-round-scores.integration.

const SCHEDULED = new Date('2026-06-04T12:00:00.000Z');

/** A golf event with `rounds` Round rows (four unless given) of `holes` holes, a day apart from SCHEDULED, and two golfers. */
function setup({ rounds = 4, holes, ...eventOverrides }: { rounds?: number; holes?: number; sport?: Sport } = {}, now?: () => Date) {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.GOLF);
  const event = store.addEvent({ providerRef: { providerId: 'balldontlie', externalId: 'golf-event-1' }, ...eventOverrides });
  // A round takes its slot's hole count when it is made, so the count is set first.
  if (holes !== undefined) store.slotPeriods.set(store.eventSlotOf(event.id).id, { unit: PeriodUnit.HOLE, count: holes });
  void store.addRounds(event.id, Array.from({ length: rounds }, (_, index) => ({ roundNumber: index + 1, scheduledDate: new Date(SCHEDULED.getTime() + index * 24 * 60 * 60 * 1000) })));
  const ana = store.addParticipant(sport.id, 'Ana Park', { id: idOf('Ana Park'), externalId: 'ext-ana' });
  const ben = store.addParticipant(sport.id, 'Ben Cole', { id: idOf('Ben Cole') });
  const anaEntry = store.addToField(event.id, ana.id);
  const benEntry = store.addToField(event.id, ben.id);
  const domainEvents = new RecordingDomainEvents();
  const fieldGames = store.fieldGameRepo();
  const service = new StrokePlayResultService({
    events: store.sportEventRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    mappings: store.mappingRepo(),
    fieldGames,
    storesGolfRoundScores: eventStoresGolfRoundScores,
    domainEvents,
    now,
  });
  return { store, service, event, anaEntry, benEntry, sport, domainEvents, fieldGames };
}

/** A golfer's rounds as stored: their side results in the event's FIELD Games, in round order. */
const roundsOf = (store: InMemorySportEvents, entryId: string) => store.fieldSideRows
  .filter((row) => row.sportEventParticipantId === entryId)
  .sort((left, right) => left.roundNumber - right.roundNumber)
  .map(({ roundNumber, score, scoreToPar, periodsCompleted, status, gameStatus, gameCompletedAt }) => ({ roundNumber, score, scoreToPar, periodsCompleted, status, gameStatus, gameCompletedAt }));

const standingOf = (store: InMemorySportEvents, entryId: string) => store.standingRows.find((row) => row.sportEventParticipantId === entryId);

const row = (overrides = {}) => ({ strokes: 70, scoreToPar: -2, thru: 18, status: 'FINISHED' as const, ...overrides });

describe('StrokePlayResultService — events of another scoring family', () => {
  it('takes golf round scores for a golf event, whose stroke-play family keeps them', () => {
    expect(eventStoresGolfRoundScores({ sport: Sport.GOLF, ...sportPlay(Sport.GOLF) })).toBe(true);
  });

  it('refuses preview, apply and a single correction for a horse racing event with 422 EVENT_SCORING_FAMILY_MISMATCH, writing no golf round', async () => {
    expect(eventStoresGolfRoundScores({ sport: Sport.HORSE_RACING, ...sportPlay(Sport.HORSE_RACING) })).toBe(false);
    const { store, service, event, anaEntry } = setup({ sport: Sport.HORSE_RACING });
    const mismatch = { code: 'EVENT_SCORING_FAMILY_MISMATCH', statusCode: 422 };

    await expect(service.previewRoundScores(event.id, 1, [{ participantId: anaEntry.participantId, ...row() }])).rejects.toMatchObject(mismatch);
    await expect(service.applyRoundScores(event.id, 1, [{ participantId: anaEntry.participantId, ...row() }])).rejects.toMatchObject(mismatch);
    await expect(service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 70, scoreToPar: -2 })).rejects.toMatchObject(mismatch);
    expect(store.fieldSideRows).toEqual([]);
  });
});

describe('StrokePlayResultService — preview', () => {
  it('resolves rows within the event\'s field and reports CREATE, UPDATE or UNCHANGED against what is stored', async () => {
    const { service, event } = setup();
    await service.applyRoundScores(event.id, 1, [{ participantId: undefined, externalId: 'ext-ana', ...row() }]);

    const preview = await service.previewRoundScores(event.id, 1, [
      { externalId: 'ext-ana', ...row() },
      { participantId: idOf('Ben Cole'), ...row({ strokes: 72, scoreToPar: 0 }) },
      { participantId: idOf('Nobody'), ...row() },
    ]);

    expect(preview.map((entry) => [entry.resolution, entry.participantName, entry.change])).toEqual([
      ['MATCHED', 'Ana Park', 'UNCHANGED'],
      ['MATCHED', 'Ben Cole', 'CREATE'],
      ['UNRESOLVED', null, 'CREATE'],
    ]);
  });

  it('a row with no strokes previews as SKIPPED, because apply never stores it', async () => {
    const { service, event } = setup();
    await service.applyRoundScores(event.id, 1, [{ participantId: idOf('Ana Park'), ...row() }]);

    const preview = await service.previewRoundScores(event.id, 1, [
      { participantId: idOf('Ana Park'), ...row({ strokes: null, scoreToPar: -3 }) },
      { participantId: idOf('Ben Cole'), ...row({ strokes: null }) },
    ]);

    expect(preview.map((entry) => [entry.resolution, entry.participantName, entry.change])).toEqual([
      ['MATCHED', 'Ana Park', 'SKIPPED'],
      ['MATCHED', 'Ben Cole', 'SKIPPED'],
    ]);
  });
});

describe('StrokePlayResultService — apply', () => {
  it('writes nothing when any row is unresolved, 422 ROUND_SCORE_ROWS_UNRESOLVED', async () => {
    const { store, service, event } = setup();

    await expect(service.applyRoundScores(event.id, 1, [{ participantId: idOf('Ana Park'), ...row() }, { participantId: idOf('Nobody'), ...row() }]))
      .rejects.toMatchObject({ code: 'ROUND_SCORE_ROWS_UNRESOLVED', statusCode: 422 });
    expect(store.fieldSideRows).toEqual([]);
  });

  it('stores each golfer\'s round on its FIELD Game, skips rows with no strokes, and totals each standing', async () => {
    const { store, service, event, anaEntry, benEntry } = setup();

    await service.applyRoundScores(event.id, 1, [{ participantId: idOf('Ana Park'), ...row() }, { participantId: idOf('Ben Cole'), ...row({ strokes: null }) }]);
    await service.applyRoundScores(event.id, 2, [{ participantId: idOf('Ana Park'), ...row({ strokes: 68, scoreToPar: -4, status: null, thru: 9 }) }]);

    expect(roundsOf(store, anaEntry.id)).toEqual([
      expect.objectContaining({ roundNumber: 1, score: 70, scoreToPar: -2, periodsCompleted: 18, status: 'FINISHED' }),
      expect.objectContaining({ roundNumber: 2, score: 68, scoreToPar: -4, periodsCompleted: 9, status: null }),
    ]);
    expect(roundsOf(store, benEntry.id)).toEqual([]);
    expect(standingOf(store, anaEntry.id)).toMatchObject({ status: 'IN_PROGRESS', scoreToPar: -6, total: 138 });
  });

  it('marks a golfer who missed the cut ELIMINATED on the standing, with the round itself finished', async () => {
    const { service, store, event, anaEntry } = setup();

    await service.applyRoundScores(event.id, 1, [{ participantId: idOf('Ana Park'), ...row({ status: 'FINISHED', missedCut: true }) }]);

    expect(standingOf(store, anaEntry.id)?.status).toBe('ELIMINATED');
    expect(roundsOf(store, anaEntry.id)).toEqual([expect.objectContaining({ status: 'FINISHED' })]);
  });

  it('keeps a round\'s Game in progress while any golfer in it is on the course, and completes it at the latest finish sent once every golfer has finished', async () => {
    const { service, store, event, anaEntry, benEntry } = setup();

    await service.applyRoundScores(event.id, 1, [
      { participantId: idOf('Ana Park'), ...row({ completedAt: '2026-06-04T17:00:00.000Z' }) },
      { participantId: idOf('Ben Cole'), ...row({ status: null, thru: 12 }) },
    ]);
    expect(roundsOf(store, anaEntry.id)).toEqual([expect.objectContaining({ gameStatus: 'IN_PROGRESS', gameCompletedAt: null })]);

    await service.applyRoundScores(event.id, 1, [{ participantId: idOf('Ben Cole'), ...row({ completedAt: '2026-06-04T18:30:00.000Z' }) }]);
    expect(roundsOf(store, benEntry.id)).toEqual([expect.objectContaining({ gameStatus: 'COMPLETED', gameCompletedAt: new Date('2026-06-04T18:30:00.000Z') })]);
  });
});

describe('StrokePlayResultService — apply, round completion', () => {
  it('completes a round\'s Game at the time of the write when every golfer has finished and none sent a finish time, and stores a round sent with no holes as played through its slot\'s 18', async () => {
    const asOf = new Date('2026-06-04T20:00:00.000Z');
    const { service, store, event, anaEntry } = setup({ holes: 18 }, () => asOf);

    await service.applyRoundScores(event.id, 1, [
      { participantId: idOf('Ana Park'), strokes: 70, scoreToPar: -2, status: 'FINISHED' },
      { participantId: idOf('Ben Cole'), ...row() },
    ]);

    expect(roundsOf(store, anaEntry.id)).toEqual([expect.objectContaining({ periodsCompleted: 18, gameStatus: 'COMPLETED', gameCompletedAt: asOf })]);
  });
});

describe('StrokePlayResultService — single-cell correction', () => {
  it('a correction that sends strokes and to par updates the round, the event to-par and the rank', async () => {
    const { service, store, event, anaEntry, benEntry } = setup();
    await service.applyRoundScores(event.id, 1, [
      { participantId: idOf('Ana Park'), ...row({ strokes: 70, scoreToPar: -2 }) },
      { participantId: idOf('Ben Cole'), ...row({ strokes: 71, scoreToPar: -1 }) },
    ]);

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 73, scoreToPar: 1 });

    expect(roundsOf(store, anaEntry.id)).toEqual([expect.objectContaining({ status: 'FINISHED', score: 73, scoreToPar: 1, periodsCompleted: 18 })]);
    expect([benEntry.id, anaEntry.id].map((id) => standingOf(store, id)))
      .toEqual([
        expect.objectContaining({ position: 1, total: 71, scoreToPar: -1 }),
        expect.objectContaining({ position: 2, total: 73, scoreToPar: 1 }),
      ]);
  });

  it('a correction that finishes the round\'s last golfer completes the round\'s Game at the finish time it sends', async () => {
    const { service, store, event, anaEntry, benEntry } = setup();
    await service.applyRoundScores(event.id, 1, [
      { participantId: idOf('Ana Park'), ...row({ completedAt: '2026-06-04T17:00:00.000Z' }) },
      { participantId: idOf('Ben Cole'), ...row({ status: null, thru: 12 }) },
    ]);

    await service.updateRoundScore(event.id, 1, benEntry.id, { thru: 18, status: 'FINISHED', completedAt: '2026-06-04T18:45:00.000Z' });

    expect(roundsOf(store, anaEntry.id)).toEqual([expect.objectContaining({ gameStatus: 'COMPLETED', gameCompletedAt: new Date('2026-06-04T18:45:00.000Z') })]);
  });

  it('refuses a field row that is not on this event with 404 EVENT_PARTICIPANT_NOT_FOUND', async () => {
    const { service, event } = setup();

    await expect(service.updateRoundScore(event.id, 1, 'missing', { strokes: 70 }))
      .rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_FOUND', statusCode: 404 });
  });

  // #398 — the server never fills in strokes or to par (#116), so a correction that would
  // create a golfer's round must carry both.
  it.each([
    ['thru only', { thru: 9 }],
    ['status only', { status: 'FINISHED' as const }],
    ['strokes without to par', { strokes: 70 }],
    ['to par without strokes', { scoreToPar: -2 }],
  ])('refuses a correction with %s for a golfer with no stored round with 422 ROUND_VALUES_REQUIRED, writing nothing', async (_label, patch) => {
    const { store, service, event, anaEntry } = setup();

    await expect(service.updateRoundScore(event.id, 1, anaEntry.id, patch))
      .rejects.toMatchObject({ code: 'ROUND_VALUES_REQUIRED', statusCode: 422 });
    expect(store.roundRows).toHaveLength(4);
    expect(store.fieldSideRows).toEqual([]);
  });

  it('a correction with strokes and to par for a golfer with no stored round creates the round with exactly those values', async () => {
    const { store, service, event, anaEntry } = setup();

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 71, scoreToPar: -1 });

    expect(roundsOf(store, anaEntry.id)).toEqual([expect.objectContaining({ status: null, score: 71, scoreToPar: -1, periodsCompleted: null })]);
  });
});

// #375, #2008 — nothing is scored after the 18th hole of the event's last round. An admin cannot
// create a round the event does not have: its rounds are its Round rows.
describe('StrokePlayResultService — admin rounds are bounded by the event schedule', () => {
  it('refuses to apply scores for a round beyond the event\'s scheduled rounds with 422 ROUND_BEYOND_SCHEDULE, writing nothing', async () => {
    const { store, service, event } = setup();

    await expect(service.applyRoundScores(event.id, 5, [{ participantId: idOf('Ana Park'), ...row() }]))
      .rejects.toMatchObject({ code: 'ROUND_BEYOND_SCHEDULE', statusCode: 422 });
    expect(store.roundRows).toHaveLength(4);
    expect(store.fieldSideRows).toEqual([]);
  });

  it('refuses a single-cell correction for a round beyond the event\'s scheduled rounds with 422 ROUND_BEYOND_SCHEDULE, writing nothing', async () => {
    const { store, service, event, anaEntry } = setup();

    await expect(service.updateRoundScore(event.id, 5, anaEntry.id, { strokes: 70 }))
      .rejects.toMatchObject({ code: 'ROUND_BEYOND_SCHEDULE', statusCode: 422 });
    expect(store.roundRows).toHaveLength(4);
    expect(store.fieldSideRows).toEqual([]);
  });

  it('refuses holes completed past the round\'s last, its slot\'s 18, with 422 ROUND_THRU_BEYOND_HOLES, as a correction and in an upload, writing no score', async () => {
    const { store, service, event, anaEntry } = setup({ holes: 18 });

    await expect(service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 70, scoreToPar: -2, thru: 19 }))
      .rejects.toMatchObject({ code: 'ROUND_THRU_BEYOND_HOLES', statusCode: 422 });
    await expect(service.applyRoundScores(event.id, 1, [{ participantId: anaEntry.participantId, strokes: 70, scoreToPar: -2, thru: 19, status: 'FINISHED' }]))
      .rejects.toMatchObject({ code: 'ROUND_THRU_BEYOND_HOLES', statusCode: 422 });
    expect(store.fieldSideRows).toEqual([]);

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 70, scoreToPar: -2, thru: 18 });
    expect(roundsOf(store, anaEntry.id).map((round) => round.periodsCompleted)).toEqual([18]);
  });

  it('stores a finished round reported with no holes as played through every hole its slot gives a round, and leaves it unknown on a slot with no hole count', async () => {
    const { store, service, event, anaEntry } = setup({ holes: 9 });

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 35, scoreToPar: -1, status: 'FINISHED' });
    expect(roundsOf(store, anaEntry.id).map((round) => round.periodsCompleted)).toEqual([9]);

    const noHoles = setup();
    await noHoles.service.updateRoundScore(noHoles.event.id, 1, noHoles.anaEntry.id, { strokes: 35, scoreToPar: -1, status: 'FINISHED' });
    expect(roundsOf(noHoles.store, noHoles.anaEntry.id).map((round) => round.periodsCompleted)).toEqual([null]);
  });

  it('refuses to preview a round beyond the event\'s scheduled rounds with 422 ROUND_BEYOND_SCHEDULE', async () => {
    const { service, event } = setup();

    await expect(service.previewRoundScores(event.id, 5, [{ participantId: idOf('Ana Park'), ...row() }]))
      .rejects.toMatchObject({ code: 'ROUND_BEYOND_SCHEDULE', statusCode: 422 });
  });

  it('still accepts the event\'s last scheduled round', async () => {
    const { store, service, event } = setup();

    await service.applyRoundScores(event.id, 4, [{ participantId: idOf('Ana Park'), ...row() }]);

    expect(store.fieldSideRows).toHaveLength(1);
    expect(store.roundRows).toHaveLength(4);
  });

  it('refuses scores for an event with no rounds yet with 422 ROUND_BEYOND_SCHEDULE, creating none: rounds come only from its schedule', async () => {
    const { store, service, event } = setup({ rounds: 0 });

    await expect(service.applyRoundScores(event.id, 1, [{ participantId: idOf('Ana Park'), ...row() }]))
      .rejects.toMatchObject({ code: 'ROUND_BEYOND_SCHEDULE', statusCode: 422 });
    expect(store.roundRows).toEqual([]);
  });
});

// #246 — event-side position: the provider supplies no live rank, so every score write
// re-ranks the whole event from its to-par, once, instead of each reader deriving it.
describe('StrokePlayResultService — event-side position', () => {
  const positions = (store: InMemorySportEvents) =>
    Object.fromEntries(store.standingRows.map((standing) => [standing.sportEventParticipantId, [standing.position, standing.displayPosition]]));

  it('ranks the field lower-is-better with ties shown as "T", and re-ranks everyone when one golfer is corrected', async () => {
    const { store, service, event, anaEntry, benEntry, sport } = setup();
    const cara = store.addParticipant(sport.id, 'Cara Diaz', { id: idOf('Cara Diaz') });
    const caraEntry = store.addToField(event.id, cara.id);

    await service.applyRoundScores(event.id, 1, [
      { participantId: idOf('Ana Park'), ...row({ scoreToPar: -2 }) },
      { participantId: idOf('Ben Cole'), ...row({ scoreToPar: -2 }) },
      { participantId: idOf('Cara Diaz'), ...row({ scoreToPar: 1 }) },
    ]);
    expect(positions(store)).toEqual({
      [anaEntry.id]: [1, 'T1'],
      [benEntry.id]: [1, 'T1'],
      [caraEntry.id]: [3, '3'],
    });

    // One golfer's correction moves the others: only Cara's score changes, every rank moves.
    await service.updateRoundScore(event.id, 1, caraEntry.id, { scoreToPar: -5 });
    expect(positions(store)).toEqual({
      [caraEntry.id]: [1, '1'],
      [anaEntry.id]: [2, 'T2'],
      [benEntry.id]: [2, 'T2'],
    });
  });

  it('leaves a golfer who missed the cut unranked, and ranks the rest without them', async () => {
    const { store, service, event, anaEntry, benEntry } = setup();

    await service.applyRoundScores(event.id, 1, [
      { participantId: idOf('Ana Park'), ...row({ scoreToPar: 3 }) },
      { participantId: idOf('Ben Cole'), ...row({ scoreToPar: -4, status: 'FINISHED', missedCut: true }) },
    ]);

    expect(positions(store)).toEqual({
      [anaEntry.id]: [1, '1'],
      [benEntry.id]: [null, null],
    });
  });
});

// #118, #435 — a playoff is not a round. Provider sync writes only the event's own rounds, so a
// stray round 5 from a feed never becomes a fifth round or moves anyone's 72-hole score.
describe('StrokePlayResultService — provider sync', () => {
  async function syncSetup() {
    const store = new InMemorySportEvents();
    const sport = store.addSport(Sport.GOLF);
    const event = store.addEvent({ providerRef: { providerId: 'balldontlie', externalId: 'golf-event-1' } });
    const ana = store.addParticipant(sport.id, 'Ana Park', { id: idOf('Ana Park') });
    const ben = store.addParticipant(sport.id, 'Ben Cole', { id: idOf('Ben Cole') });
    const anaEntry = store.addToField(event.id, ana.id);
    const benEntry = store.addToField(event.id, ben.id);
    const mappedAt = new Date('2026-06-01T12:00:00.000Z');
    await store.mappingRepo().bind({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId: 'ext-ana', participantId: ana.id, sportLeagueId: ana.sportLeagueId, participantType: 'INDIVIDUAL', mappedAt });
    await store.mappingRepo().bind({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId: 'ext-ben', participantId: ben.id, sportLeagueId: ben.sportLeagueId, participantType: 'INDIVIDUAL', mappedAt });
    const logger = fakeLogger();
    const fieldGames = store.fieldGameRepo();
    const service = new StrokePlayResultService({ domainEvents: testDomainEvents(),
      events: store.sportEventRepo(),
      rounds: store.roundRepo(),
      field: store.fieldRepo(),
      participants: store.participantRepo(),
      mappings: store.mappingRepo(),
      fieldGames,
      storesGolfRoundScores: eventStoresGolfRoundScores,
      logger,
    });
    return { store, service, event, anaEntry, benEntry, logger, fieldGames };
  }

  const update = (participantExternalId: string, round: number, scoreToPar: number) => ({
    participantExternalId, round, strokes: 72 + scoreToPar, scoreToPar, thru: 18, status: 'FINISHED' as const,
  });
  const fourRounds = [1, 2, 3, 4].map((roundNumber) => ({ roundNumber, scheduledDate: SCHEDULED }));

  it('skips and logs a round the event does not have, so the golfer keeps their 72-hole score', async () => {
    const { store, service, event, anaEntry, logger } = await syncSetup();
    await store.addRounds(event.id, fourRounds);

    const result = await service.persistRoundUpdatesForSportEvent(
      event.id,
      [1, 2, 3, 4].map((round) => update('ext-ana', round, -2)).concat(update('ext-ana', 5, -1)),
      'balldontlie'
    );

    expect(result).toMatchObject({ updatesReturned: 5, updatesPersisted: 4, updatesSkipped: 1 });
    expect(store.roundRows.filter((round) => round.sportEventId === event.id).map((round) => round.roundNumber)).toEqual([1, 2, 3, 4]);
    expect(standingOf(store, anaEntry.id)?.scoreToPar).toBe(-8);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.unscheduledRoundSkipped', data: { sportEventId: event.id, roundNumbers: [5] } },
      expect.any(String),
    );
  });

  it('records the feed\'s final call on the event\'s slots with the refresh of their status, even when no score moved, and records none before it', async () => {
    const { store, service, event } = await syncSetup();
    await store.addRounds(event.id, fourRounds);
    const rounds = [1, 2, 3, 4].map((round) => update('ext-ana', round, -1));

    await service.persistRoundUpdatesForSportEvent(event.id, rounds, 'balldontlie');
    expect(store.feedFinalAtByEvent.has(event.id)).toBe(false);
    store.backgroundJobs.length = 0;

    await service.persistRoundUpdatesForSportEvent(event.id, rounds, 'balldontlie', { final: true });

    expect(store.feedFinalAtByEvent.get(event.id)).toBeInstanceOf(Date);
    expect(store.backgroundJobs).toEqual(expect.arrayContaining([slotStatusRefreshJob(event.id)]));
  });

  it('writes nothing and queues no job on a later tick that repeats the feed\'s final call with no score moved', async () => {
    const { store, service, event } = await syncSetup();
    await store.addRounds(event.id, fourRounds);
    const rounds = [1, 2, 3, 4].map((round) => update('ext-ana', round, -1));
    await service.persistRoundUpdatesForSportEvent(event.id, rounds, 'balldontlie', { final: true });
    const firstCall = store.feedFinalAtByEvent.get(event.id);
    store.backgroundJobs.length = 0;

    await service.persistRoundUpdatesForSportEvent(event.id, rounds, 'balldontlie', { final: true });

    expect(store.backgroundJobs).toEqual([]);
    expect(store.feedFinalAtByEvent.get(event.id)).toBe(firstCall);
  });

  it('skips a score for a round on an event with no round schedule rather than creating the round', async () => {
    const { store, service, event, logger } = await syncSetup();

    const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2)], 'balldontlie');

    expect(result).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    expect(store.roundRows.filter((round) => round.sportEventId === event.id)).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.unscheduledRoundSkipped', data: { sportEventId: event.id, roundNumbers: [1] } },
      expect.any(String),
    );
  });

  it('completes a round\'s Game at the finish time the feed sends once both golfers have finished it', async () => {
    const { store, service, event, anaEntry } = await syncSetup();
    await store.addRounds(event.id, fourRounds);

    await service.persistRoundUpdatesForSportEvent(event.id, [
      { ...update('ext-ana', 1, -2), completedAt: '2026-06-04T17:10:00.000Z' },
      { ...update('ext-ben', 1, 1), completedAt: '2026-06-04T18:20:00.000Z' },
    ], 'balldontlie');

    expect(roundsOf(store, anaEntry.id)).toEqual([expect.objectContaining({ gameStatus: 'COMPLETED', gameCompletedAt: new Date('2026-06-04T18:20:00.000Z') })]);
  });

  it('gives two golfers tied after 72 holes the same event score and both "T1"', async () => {
    const { store, service, event, anaEntry, benEntry } = await syncSetup();
    await store.addRounds(event.id, fourRounds);

    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -3), update('ext-ana', 2, -3), update('ext-ana', 3, -3), update('ext-ana', 4, -3),
      update('ext-ben', 1, -6), update('ext-ben', 2, -2), update('ext-ben', 3, -2), update('ext-ben', 4, -2),
    ], 'balldontlie');

    expect([anaEntry.id, benEntry.id].map((id) => [standingOf(store, id)?.scoreToPar, standingOf(store, id)?.displayPosition])).toEqual([[-12, 'T1'], [-12, 'T1']]);
  });

  it('gives a cut golfer no side in the rounds after the cut: their sides come only from the rounds the feed reports them in', async () => {
    const { store, service, event, anaEntry, benEntry } = await syncSetup();
    await store.addRounds(event.id, fourRounds);

    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -1), update('ext-ana', 2, -1), update('ext-ana', 3, -1),
      update('ext-ben', 1, 4), { ...update('ext-ben', 2, 5), status: 'FINISHED', missedCut: true as const },
    ], 'balldontlie');

    expect(roundsOf(store, benEntry.id).map((round) => round.roundNumber)).toEqual([1, 2]);
    expect(roundsOf(store, anaEntry.id).map((round) => round.roundNumber)).toEqual([1, 2, 3]);
    expect(standingOf(store, benEntry.id)).toMatchObject({ status: 'ELIMINATED', position: null });
  });

  it('skips and logs an update past the round\'s last hole, its slot\'s 18, so playoff holes never reach a round score', async () => {
    const { store, service, event, logger } = await syncSetup();
    store.slotPeriods.set(store.eventSlotOf(event.id).id, { unit: PeriodUnit.HOLE, count: 18 });
    await store.addRounds(event.id, fourRounds);

    const result = await service.persistRoundUpdatesForSportEvent(
      event.id,
      [update('ext-ana', 4, -2), { ...update('ext-ben', 4, -3), thru: 19 }],
      'balldontlie'
    );

    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 1, updatesSkipped: 1 });
    expect(store.fieldSideRows).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.holeBeyondRoundSkipped', data: { sportEventId: event.id, externalId: 'ext-ben', round: 4, thru: 19, holes: 18 } },
      expect.any(String),
    );
  });

  describe('a live tick writes only what changed (#1164)', () => {
    async function scheduledSyncSetup() {
      const setup = await syncSetup();
      await setup.store.addRounds(setup.event.id, fourRounds);
      return setup;
    }

    it('a tick that repeats the last scores writes nothing and reports every row UNCHANGED', async () => {
      const { store, service, event, fieldGames } = await scheduledSyncSetup();
      const tick = [update('ext-ana', 1, -2), update('ext-ben', 1, 1)];
      await service.persistRoundUpdatesForSportEvent(event.id, tick, 'balldontlie');
      const standingsAfterFirstTick = store.standingRows.map((row) => ({ ...row }));
      const writes = jest.spyOn(fieldGames, 'applyResults');

      const result = await service.persistRoundUpdatesForSportEvent(event.id, tick, 'balldontlie');

      expect(writes).not.toHaveBeenCalled();
      expect(result.writeDiagnostics.summary).toEqual({ total: 4, unchanged: 4, created: 0, updated: 0, deleted: 0 });
      expect(store.standingRows).toEqual(standingsAfterFirstTick);
    });

    it('writes only the golfer whose round changed, in one write with every standing it moves, and re-ranks the field', async () => {
      const { store, service, event, anaEntry, benEntry, fieldGames } = await scheduledSyncSetup();
      await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2), update('ext-ben', 1, 1)], 'balldontlie');
      const writes = jest.spyOn(fieldGames, 'applyResults');

      const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2), update('ext-ben', 1, -4)], 'balldontlie');

      expect(writes).toHaveBeenCalledTimes(1);
      const [, apply] = writes.mock.calls[0];
      expect(apply.games.flatMap((game) => game.sides)).toEqual([expect.objectContaining({ sportEventParticipantId: benEntry.id, scoreToPar: -4 })]);
      // Ben's new score moves both ranks, so both standings are written.
      expect(apply.standings.map((standing) => [standing.sportEventParticipantId, standing.displayPosition]))
        .toEqual(expect.arrayContaining([[anaEntry.id, '2'], [benEntry.id, '1']]));
      expect(apply.standings).toHaveLength(2);
      // Ana's round is unchanged; Ben's round, and both standings (Ana's rank moved), are updated.
      expect(result.writeDiagnostics.summary).toMatchObject({ unchanged: 1, updated: 3, created: 0 });
      expect([anaEntry.id, benEntry.id].map((id) => standingOf(store, id)?.displayPosition)).toEqual(['2', '1']);
    });

    it.each([
      [
        'only holes played (thru) changed, so the round\'s holes thru moves',
        { thru: 10 },
        { periodsCompleted: 10 },
        { status: 'IN_PROGRESS', displayPosition: '1' },
        // A standing keeps no holes thru (#2008), so it is unchanged.
        { updated: 1, unchanged: 1 },
      ],
      [
        'only the status changed, to a withdrawal (DID_NOT_FINISH), so the standing is WITHDRAWN and unranked',
        { status: 'DID_NOT_FINISH' as const },
        { status: 'DID_NOT_FINISH' },
        { status: 'WITHDRAWN', position: null, displayPosition: null },
        { updated: 2, unchanged: 0 },
      ],
    ])('rewrites a round, and its standing where it moves, when %s', async (_label, change, expectedRound, expectedStanding, expectedSummary) => {
      const first = { strokes: 34, scoreToPar: -2, thru: 9, status: null };
      const { store, service, event, anaEntry } = await scheduledSyncSetup();
      const tick = (values: object) => service.persistRoundUpdatesForSportEvent(event.id, [{ participantExternalId: 'ext-ana', round: 1, ...first, ...values }], 'balldontlie');
      await tick({});

      const result = await tick(change);

      expect(roundsOf(store, anaEntry.id)).toEqual([expect.objectContaining(expectedRound)]);
      expect(result.writeDiagnostics.summary).toMatchObject(expectedSummary);
      expect(standingOf(store, anaEntry.id)).toMatchObject(expectedStanding);
    });

    it('when a payload carries the same golfer\'s round twice, stores the later one with a single write', async () => {
      const { store, service, event, anaEntry, fieldGames } = await scheduledSyncSetup();
      const writes = jest.spyOn(fieldGames, 'applyResults');

      const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -1), update('ext-ana', 1, -3)], 'balldontlie');

      expect(writes).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 1, updatesSkipped: 0 });
      expect(roundsOf(store, anaEntry.id).map((round) => round.scoreToPar)).toEqual([-3]);
      expect(standingOf(store, anaEntry.id)?.scoreToPar).toBe(-3);
      expect(result.writeDiagnostics.summary).toMatchObject({ created: 2, total: 2 });
    });

    it('recreates a missing standing on a tick whose rounds did not change, so a standing a failed tick lost is put right', async () => {
      const { store, service, event, anaEntry } = await scheduledSyncSetup();
      await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2)], 'balldontlie');
      store.standingRows = [];

      await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2)], 'balldontlie');

      expect(standingOf(store, anaEntry.id)).toMatchObject({ scoreToPar: -2, displayPosition: '1' });
    });
  });
});

describe('StrokePlayResultService — leaderboard rebuild (#1466)', () => {
  it('writes the event\'s leaderboard rebuild job with the results, and wakes the runner after it', async () => {
    const { store, service, event, anaEntry, domainEvents } = setup();

    await service.applyRoundScores(event.id, 1, [{ participantId: anaEntry.participantId, ...row() }]);

    // The round's Game moved, so its slot's status is refreshed with it (#2013).
    expect(store.backgroundJobs).toEqual([eventRebuildJob(event.id), slotStatusRefreshJob(event.id)]);
    expect(domainEvents.changedSportEventIds).toEqual([event.id]);
  });

  it('wakes no runner when the write carrying the rebuild fails, and the failure reaches the caller', async () => {
    const { store, event, anaEntry, domainEvents, fieldGames } = setup();
    const failing = new StrokePlayResultService({
      events: store.sportEventRepo(),
      rounds: store.roundRepo(),
      field: store.fieldRepo(),
      participants: store.participantRepo(),
      mappings: store.mappingRepo(),
      fieldGames: { ...fieldGames, applyResults: () => Promise.reject(new Error('results write failed')) },
      storesGolfRoundScores: eventStoresGolfRoundScores,
      domainEvents,
    });

    await expect(failing.applyRoundScores(event.id, 1, [{ participantId: anaEntry.participantId, ...row() }])).rejects.toThrow('results write failed');
    expect(domainEvents.handedOutSportEventIds).toEqual([event.id]);
    expect(domainEvents.changedSportEventIds).toEqual([]);
  });
});
