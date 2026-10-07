import { Sport } from '@poolmaster/shared/domain';
import { GolfScoreService } from '../../../packages/core-api/src/modules/golf/golf-score-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { fakeLogger } from '../../support/fake-logger';

// The golf score-correction rules against an in-memory store: what a preview reports, that
// apply is all or none, how a correction merges, and how a standing is totalled. The sync
// path's writes against Postgres are in golf-round-scores.integration.

function setup(eventOverrides: { rounds?: number } = {}) {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.GOLF);
  const event = store.addEvent({ providerId: 'feed', ...eventOverrides });
  const ana = store.addParticipant(sport.id, 'Ana Park', { externalId: 'ext-ana' });
  const ben = store.addParticipant(sport.id, 'Ben Cole');
  const anaEntry = store.addToField(event.id, ana.id);
  const benEntry = store.addToField(event.id, ben.id);
  const service = new GolfScoreService({
    events: store.sportEventRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    mappings: store.mappingRepo(),
    golfRounds: store.golfRoundRepo(),
    golfStandings: store.golfStandingRepo(),
  });
  return { store, service, event, anaEntry, benEntry, sport };
}

const row = (overrides = {}) => ({ strokes: 70, scoreToPar: -2, thru: 18, status: 'COMPLETED' as const, ...overrides });

describe('GolfScoreService — preview', () => {
  it('resolves rows within the event\'s field and reports CREATE, UPDATE or UNCHANGED against what is stored', async () => {
    const { service, event } = setup();
    await service.applyRoundScores(event.id, 1, [{ participantId: undefined, externalId: 'ext-ana', ...row() }]);

    const preview = await service.previewRoundScores(event.id, 1, [
      { externalId: 'ext-ana', ...row() },
      { playerName: 'ben cole', ...row({ strokes: 72, scoreToPar: 0 }) },
      { playerName: 'Nobody', ...row() },
    ]);

    expect(preview.map((entry) => [entry.resolution, entry.participantName, entry.change])).toEqual([
      ['MATCHED', 'Ana Park', 'UNCHANGED'],
      ['MATCHED', 'Ben Cole', 'CREATE'],
      ['UNRESOLVED', null, 'CREATE'],
    ]);
  });
  it('a row with no strokes previews as SKIPPED, because apply never stores it', async () => {
    const { service, event } = setup();
    await service.applyRoundScores(event.id, 1, [{ playerName: 'Ana Park', ...row() }]);

    const preview = await service.previewRoundScores(event.id, 1, [
      { playerName: 'Ana Park', ...row({ strokes: null, scoreToPar: -3 }) },
      { playerName: 'Ben Cole', ...row({ strokes: null }) },
    ]);

    expect(preview.map((entry) => [entry.resolution, entry.participantName, entry.change])).toEqual([
      ['MATCHED', 'Ana Park', 'SKIPPED'],
      ['MATCHED', 'Ben Cole', 'SKIPPED'],
    ]);
  });
});

describe('GolfScoreService — apply', () => {
  it('writes nothing when any row is unresolved, 422 ROUND_SCORE_ROWS_UNRESOLVED', async () => {
    const { store, service, event } = setup();

    await expect(service.applyRoundScores(event.id, 1, [{ playerName: 'Ana Park', ...row() }, { playerName: 'Nobody', ...row() }]))
      .rejects.toMatchObject({ code: 'ROUND_SCORE_ROWS_UNRESOLVED', statusCode: 422 });
    expect(store.golfRoundRows).toEqual([]);
  });

  it('creates the round if needed, skips rows with no strokes, and totals each standing', async () => {
    const { store, service, event, anaEntry } = setup();

    await service.applyRoundScores(event.id, 1, [{ playerName: 'Ana Park', ...row() }, { playerName: 'Ben Cole', ...row({ strokes: null }) }]);
    await service.applyRoundScores(event.id, 2, [{ playerName: 'Ana Park', ...row({ strokes: 68, scoreToPar: -4, status: 'IN_PROGRESS', thru: 9 }) }]);

    expect(store.roundRows.map((round) => round.roundNumber)).toEqual([1, 2]);
    expect(store.golfRoundRows).toHaveLength(2);
    const [standing] = await store.golfStandingRepo().findBySportEventParticipants([anaEntry.id]);
    expect(standing).toMatchObject({
      standing: { currentRound: 2, status: 'IN_PROGRESS' },
      golf: { eventScoreToPar: -6, eventStrokes: 138, currentRoundThru: 9 },
    });
  });

  it('marks a golfer who missed the cut ELIMINATED on the cross-sport standing', async () => {
    const { service, store, event, anaEntry } = setup();

    await service.applyRoundScores(event.id, 1, [{ playerName: 'Ana Park', ...row({ status: 'MISSED_CUT' }) }]);

    const [standing] = await store.golfStandingRepo().findBySportEventParticipants([anaEntry.id]);
    expect(standing.standing.status).toBe('ELIMINATED');
  });
});

describe('GolfScoreService — single-cell correction', () => {
  it('a correction that sends strokes and to par updates the round, the event to-par and the rank', async () => {
    const { service, store, event, anaEntry, benEntry } = setup();
    await service.applyRoundScores(event.id, 1, [
      { playerName: 'Ana Park', ...row({ strokes: 70, scoreToPar: -2 }) },
      { playerName: 'Ben Cole', ...row({ strokes: 71, scoreToPar: -1 }) },
    ]);

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 73, scoreToPar: 1 });

    const [round] = await store.golfRoundRepo().findBySportEventParticipants([anaEntry.id]);
    expect(round).toMatchObject({ participantRound: { status: 'COMPLETED' }, golf: { strokes: 73, scoreToPar: 1, thru: 18 } });
    const standings = Object.fromEntries((await store.golfStandingRepo().findBySportEvent(event.id)).map((result) => [
      result.standing.sportEventParticipantId,
      { position: result.standing.position, eventStrokes: result.golf.eventStrokes, eventScoreToPar: result.golf.eventScoreToPar },
    ]));
    expect(standings).toEqual({
      [benEntry.id]: { position: 1, eventStrokes: 71, eventScoreToPar: -1 },
      [anaEntry.id]: { position: 2, eventStrokes: 73, eventScoreToPar: 1 },
    });
  });

  it('a correction stores completedAt exactly as sent, and never derives it from the status', async () => {
    const { service, store, event, anaEntry } = setup();
    await service.applyRoundScores(event.id, 1, [{ playerName: 'Ana Park', ...row({ status: 'IN_PROGRESS', thru: 12 }) }]);

    await service.updateRoundScore(event.id, 1, anaEntry.id, { status: 'COMPLETED', thru: 18 });
    let [round] = await store.golfRoundRepo().findBySportEventParticipants([anaEntry.id]);
    expect(round.participantRound).toMatchObject({ status: 'COMPLETED', completedAt: null });

    await service.updateRoundScore(event.id, 1, anaEntry.id, { completedAt: '2026-04-10T22:15:00.000Z' });
    [round] = await store.golfRoundRepo().findBySportEventParticipants([anaEntry.id]);
    expect(round.participantRound.completedAt?.toISOString()).toBe('2026-04-10T22:15:00.000Z');

    await service.updateRoundScore(event.id, 1, anaEntry.id, { completedAt: null });
    [round] = await store.golfRoundRepo().findBySportEventParticipants([anaEntry.id]);
    expect(round.participantRound.completedAt).toBeNull();
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
    ['status only', { status: 'COMPLETED' as const }],
    ['strokes without to par', { strokes: 70 }],
    ['to par without strokes', { scoreToPar: -2 }],
  ])('refuses a correction with %s for a golfer with no stored round with 422 ROUND_VALUES_REQUIRED, writing nothing', async (_label, patch) => {
    const { store, service, event, anaEntry } = setup();

    await expect(service.updateRoundScore(event.id, 1, anaEntry.id, patch))
      .rejects.toMatchObject({ code: 'ROUND_VALUES_REQUIRED', statusCode: 422 });
    expect(store.roundRows).toEqual([]);
    expect(store.golfRoundRows).toEqual([]);
  });

  it('a correction with strokes and to par for a golfer with no stored round creates the round with exactly those values', async () => {
    const { store, service, event, anaEntry } = setup();

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 71, scoreToPar: -1 });

    const [round] = await store.golfRoundRepo().findBySportEventParticipants([anaEntry.id]);
    expect(round).toMatchObject({ participantRound: { status: 'IN_PROGRESS' }, golf: { strokes: 71, scoreToPar: -1, thru: null } });
  });
});

// #375 — nothing is scored after the 18th hole of the event's last scheduled round. An admin
// cannot create a round the event does not have; an event with no round count keeps today's
// behaviour.
describe('GolfScoreService — admin rounds are bounded by the event schedule', () => {
  it('refuses to apply scores for a round beyond the event\'s scheduled rounds with 422 ROUND_BEYOND_SCHEDULE, writing nothing', async () => {
    const { store, service, event } = setup({ rounds: 4 });

    await expect(service.applyRoundScores(event.id, 5, [{ playerName: 'Ana Park', ...row() }]))
      .rejects.toMatchObject({ code: 'ROUND_BEYOND_SCHEDULE', statusCode: 422 });
    expect(store.roundRows).toEqual([]);
    expect(store.golfRoundRows).toEqual([]);
  });

  it('refuses a single-cell correction for a round beyond the event\'s scheduled rounds with 422 ROUND_BEYOND_SCHEDULE, writing nothing', async () => {
    const { store, service, event, anaEntry } = setup({ rounds: 4 });

    await expect(service.updateRoundScore(event.id, 5, anaEntry.id, { strokes: 70 }))
      .rejects.toMatchObject({ code: 'ROUND_BEYOND_SCHEDULE', statusCode: 422 });
    expect(store.roundRows).toEqual([]);
    expect(store.golfRoundRows).toEqual([]);
  });

  it('refuses to preview a round beyond the event\'s scheduled rounds with 422 ROUND_BEYOND_SCHEDULE', async () => {
    const { service, event } = setup({ rounds: 4 });

    await expect(service.previewRoundScores(event.id, 5, [{ playerName: 'Ana Park', ...row() }]))
      .rejects.toMatchObject({ code: 'ROUND_BEYOND_SCHEDULE', statusCode: 422 });
  });

  it('still accepts the event\'s last scheduled round', async () => {
    const { store, service, event } = setup({ rounds: 4 });

    await service.applyRoundScores(event.id, 4, [{ playerName: 'Ana Park', ...row() }]);

    expect(store.roundRows.map((round) => round.roundNumber)).toEqual([4]);
  });

  it('creates any round when the event has no scheduled round count', async () => {
    const { store, service, event } = setup();

    await service.applyRoundScores(event.id, 5, [{ playerName: 'Ana Park', ...row() }]);

    expect(store.roundRows.map((round) => round.roundNumber)).toEqual([5]);
  });
});

// #246 — event-side position: the provider supplies no live rank, so every score write
// re-ranks the whole event from eventScoreToPar, once, instead of each reader deriving it.
describe('GolfScoreService — event-side position', () => {
  const positions = async (store: InMemorySportEvents, eventId: string) =>
    Object.fromEntries((await store.golfStandingRepo().findBySportEvent(eventId)).map((result) => [
      result.standing.sportEventParticipantId,
      [result.standing.position, result.standing.displayPosition],
    ]));

  it('ranks the field lower-is-better with ties shown as "T", and re-ranks everyone when one golfer is corrected', async () => {
    const { store, service, event, anaEntry, benEntry, sport } = setup();
    const cara = store.addParticipant(sport.id, 'Cara Diaz');
    const caraEntry = store.addToField(event.id, cara.id);

    await service.applyRoundScores(event.id, 1, [
      { playerName: 'Ana Park', ...row({ scoreToPar: -2 }) },
      { playerName: 'Ben Cole', ...row({ scoreToPar: -2 }) },
      { playerName: 'Cara Diaz', ...row({ scoreToPar: 1 }) },
    ]);
    await expect(positions(store, event.id)).resolves.toEqual({
      [anaEntry.id]: [1, 'T1'],
      [benEntry.id]: [1, 'T1'],
      [caraEntry.id]: [3, '3'],
    });

    // One golfer's correction moves the others: only Cara's score changes, every rank moves.
    await service.updateRoundScore(event.id, 1, caraEntry.id, { scoreToPar: -5 });
    await expect(positions(store, event.id)).resolves.toEqual({
      [caraEntry.id]: [1, '1'],
      [anaEntry.id]: [2, 'T2'],
      [benEntry.id]: [2, 'T2'],
    });
  });

  it('leaves a golfer who missed the cut unranked, and ranks the rest without them', async () => {
    const { store, service, event, anaEntry, benEntry } = setup();

    await service.applyRoundScores(event.id, 1, [
      { playerName: 'Ana Park', ...row({ scoreToPar: 3 }) },
      { playerName: 'Ben Cole', ...row({ scoreToPar: -4, status: 'MISSED_CUT' }) },
    ]);

    await expect(positions(store, event.id)).resolves.toEqual({
      [anaEntry.id]: [1, '1'],
      [benEntry.id]: [null, null],
    });
  });
});

// #118, #435 — a playoff is not a round. Provider sync writes only the rounds an admin
// scheduled, so a stray round 5 from a feed never becomes a fifth round row or moves anyone's
// 72-hole score. Every event is admin-owned; a feed never creates a round.
describe('GolfScoreService — provider sync', () => {
  async function syncSetup() {
    const store = new InMemorySportEvents();
    const sport = store.addSport(Sport.GOLF);
    const event = store.addEvent({ providerId: 'feed', syncScope: 'SCORES_ONLY' });
    const ana = store.addParticipant(sport.id, 'Ana Park');
    const ben = store.addParticipant(sport.id, 'Ben Cole');
    const anaEntry = store.addToField(event.id, ana.id);
    const benEntry = store.addToField(event.id, ben.id);
    const mappedAt = new Date('2026-06-01T12:00:00.000Z');
    await store.mappingRepo().bind({ providerId: 'feed', externalId: 'ext-ana', participantId: ana.id, confidence: 'EXACT', mappedAt });
    await store.mappingRepo().bind({ providerId: 'feed', externalId: 'ext-ben', participantId: ben.id, confidence: 'EXACT', mappedAt });
    const logger = fakeLogger();
    const service = new GolfScoreService({
      events: store.sportEventRepo(),
      rounds: store.roundRepo(),
      field: store.fieldRepo(),
      participants: store.participantRepo(),
      mappings: store.mappingRepo(),
      golfRounds: store.golfRoundRepo(),
      golfStandings: store.golfStandingRepo(),
      logger,
    });
    return { store, service, event, anaEntry, benEntry, logger };
  }

  const update = (participantExternalId: string, round: number, scoreToPar: number) => ({
    participantExternalId, round, strokes: 72 + scoreToPar, scoreToPar, thru: 18, status: 'COMPLETED' as const,
  });

  it('skips and logs a round an admin did not schedule on a SCORES_ONLY event, so the golfer keeps their 72-hole score', async () => {
    const { store, service, event, anaEntry, logger } = await syncSetup();
    await store.roundRepo().createMany(event.id, [1, 2, 3, 4].map((roundNumber) => ({ roundNumber, scheduledDate: new Date('2026-06-04T12:00:00.000Z') })));

    const result = await service.persistRoundUpdatesForSportEvent(
      event.id,
      [1, 2, 3, 4].map((round) => update('ext-ana', round, -2)).concat(update('ext-ana', 5, -1)),
      'feed',
      null,
    );

    expect(result).toMatchObject({ updatesReturned: 5, updatesPersisted: 4, updatesSkipped: 1 });
    expect(store.roundRows.filter((round) => round.sportEventId === event.id).map((round) => round.roundNumber)).toEqual([1, 2, 3, 4]);
    const [standing] = await store.golfStandingRepo().findBySportEventParticipants([anaEntry.id]);
    expect(standing.golf.eventScoreToPar).toBe(-8);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.unscheduledRoundSkipped', data: { sportEventId: event.id, roundNumbers: [5] } },
      expect.any(String),
    );
  });

  it('skips a score for a round on an event with no round schedule rather than creating the round', async () => {
    const { store, service, event, logger } = await syncSetup();

    const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2)], 'feed', null);

    expect(result).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    expect(store.roundRows.filter((round) => round.sportEventId === event.id)).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.unscheduledRoundSkipped', data: { sportEventId: event.id, roundNumbers: [1] } },
      expect.any(String),
    );
  });

  it('gives two golfers tied after 72 holes the same event score and both "T1"', async () => {
    const { store, service, event, anaEntry, benEntry } = await syncSetup();
    await store.roundRepo().createMany(event.id, [1, 2, 3, 4].map((roundNumber) => ({ roundNumber, scheduledDate: new Date('2026-06-04T12:00:00.000Z') })));

    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -3), update('ext-ana', 2, -3), update('ext-ana', 3, -3), update('ext-ana', 4, -3),
      update('ext-ben', 1, -6), update('ext-ben', 2, -2), update('ext-ben', 3, -2), update('ext-ben', 4, -2),
    ], 'feed', null);

    const standings = await store.golfStandingRepo().findBySportEventParticipants([anaEntry.id, benEntry.id]);
    expect(standings.map((result) => [result.golf.eventScoreToPar, result.standing.displayPosition])).toEqual([[-12, 'T1'], [-12, 'T1']]);
  });

  it('skips and logs a round beyond the event\'s scheduled round count, so a playoff never becomes round 5', async () => {
    const { store, service, event, anaEntry, logger } = await syncSetup();
    await store.roundRepo().createMany(event.id, [1, 2, 3, 4].map((roundNumber) => ({ roundNumber, scheduledDate: new Date('2026-06-04T12:00:00.000Z') })));

    const result = await service.persistRoundUpdatesForSportEvent(
      event.id,
      [1, 2, 3, 4].map((round) => update('ext-ana', round, -2)).concat(update('ext-ana', 5, -1)),
      'feed',
      4,
    );

    expect(result).toMatchObject({ updatesReturned: 5, updatesPersisted: 4, updatesSkipped: 1 });
    expect(store.roundRows.filter((round) => round.sportEventId === event.id).map((round) => round.roundNumber)).toEqual([1, 2, 3, 4]);
    const [standing] = await store.golfStandingRepo().findBySportEventParticipants([anaEntry.id]);
    expect(standing.golf.eventScoreToPar).toBe(-8);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.roundBeyondScheduleSkipped', data: { sportEventId: event.id, scheduledRounds: 4, roundNumbers: [5] } },
      expect.any(String),
    );
  });

  it('skips and logs an update past the 18th hole, so playoff holes never reach a round score', async () => {
    const { store, service, event, logger } = await syncSetup();
    await store.roundRepo().createMany(event.id, [1, 2, 3, 4].map((roundNumber) => ({ roundNumber, scheduledDate: new Date('2026-06-04T12:00:00.000Z') })));

    const result = await service.persistRoundUpdatesForSportEvent(
      event.id,
      [update('ext-ana', 4, -2), { ...update('ext-ben', 4, -3), thru: 19 }],
      'feed',
      4,
    );

    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 1, updatesSkipped: 1 });
    expect(store.golfRoundRows).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.holeBeyondEighteenSkipped', data: { sportEventId: event.id, externalId: 'ext-ben', round: 4, thru: 19 } },
      expect.any(String),
    );
  });
});
