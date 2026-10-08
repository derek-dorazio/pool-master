import { Sport } from '@poolmaster/shared/domain';
import { GolfScoreService } from '../../../packages/core-api/src/modules/golf/golf-score-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { fakeLogger } from '../../support/fake-logger';

// Golf scoring use cases beyond golf-score-service.test.ts: the provider sync's skip paths and
// change reporting, how a cut or withdrawn golfer's standing reads, and corrections that move a
// golfer in or out of the ranking.

async function setup() {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.GOLF);
  const event = store.addEvent({ providerId: 'feed', syncScope: 'SCORES_ONLY', rounds: 4 });
  await store.roundRepo().createMany(event.id, [1, 2, 3, 4].map((roundNumber) => ({
    roundNumber,
    scheduledDate: new Date('2026-06-04T12:00:00.000Z'),
  })));
  const ana = store.addParticipant(sport.id, 'Ana Park');
  const ben = store.addParticipant(sport.id, 'Ben Cole');
  const cara = store.addParticipant(sport.id, 'Cara Diaz');
  const anaEntry = store.addToField(event.id, ana.id);
  const benEntry = store.addToField(event.id, ben.id);
  const caraEntry = store.addToField(event.id, cara.id);
  const mappedAt = new Date('2026-06-01T12:00:00.000Z');
  for (const [externalId, participantId] of [['ext-ana', ana.id], ['ext-ben', ben.id], ['ext-cara', cara.id]]) {
    await store.mappingRepo().bind({ providerId: 'feed', externalId, participantId, confidence: 'EXACT', mappedAt });
  }
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
  return { store, service, event, sport, anaEntry, benEntry, caraEntry, logger };
}

type RoundStatus = 'IN_PROGRESS' | 'COMPLETED' | 'DNF' | 'DSQ' | 'MISSED_CUT';
const update = (participantExternalId: string, round: number, scoreToPar: number, overrides: { status?: RoundStatus; thru?: number; strokes?: number | null } = {}) => ({
  participantExternalId,
  round,
  strokes: 72 + scoreToPar,
  scoreToPar,
  thru: 18,
  status: 'COMPLETED' as RoundStatus,
  ...overrides,
});

const standingOf = async (store: InMemorySportEvents, sportEventParticipantId: string) => {
  const [standing] = await store.golfStandingRepo().findBySportEventParticipants([sportEventParticipantId]);
  return standing;
};

describe('golf provider sync — what is skipped', () => {
  it('writes nothing and reports zero for an empty payload', async () => {
    const { store, service, event } = await setup();

    await expect(service.persistRoundUpdatesForSportEvent(event.id, [], 'feed', 4)).resolves.toEqual({
      updatesReturned: 0,
      updatesPersisted: 0,
      updatesSkipped: 0,
      writeDiagnostics: { summary: { total: 0, unchanged: 0, created: 0, updated: 0, deleted: 0 }, rows: [] },
    });
    expect(store.golfRoundRows).toEqual([]);
  });

  it('skips and logs an update for a provider golfer with no mapping, and still stores the others', async () => {
    const { store, service, event, logger } = await setup();

    const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -1), update('ext-stranger', 1, -5)], 'feed', 4);

    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 1, updatesSkipped: 1 });
    expect(store.golfRoundRows).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.unmappedExternalId', data: { providerId: 'feed', externalId: 'ext-stranger' } },
      expect.any(String),
    );
  });

  it('skips and logs an update for a mapped golfer who is not on this event\'s field', async () => {
    const { store, service, event, sport, logger } = await setup();
    const outsider = store.addParticipant(sport.id, 'Dan Outsider');
    await store.mappingRepo().bind({ providerId: 'feed', externalId: 'ext-dan', participantId: outsider.id, confidence: 'EXACT', mappedAt: new Date() });

    const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-dan', 1, -3)], 'feed', 4);

    expect(result).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    expect(store.golfRoundRows).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.noSportEventParticipant', data: { participantId: outsider.id, externalId: 'ext-dan', sportEventId: event.id } },
      expect.any(String),
    );
  });

  it('skips an update with no per-round strokes, since a round is never stored without them', async () => {
    const { store, service, event } = await setup();

    const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2, { strokes: null })], 'feed', 4);

    expect(result).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    expect(store.golfRoundRows).toEqual([]);
  });

  it('applies two updates for the same golfer and round in payload order, so the later one is stored', async () => {
    const { store, service, event, anaEntry } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -1, { status: 'IN_PROGRESS', thru: 9 }),
      update('ext-ana', 1, -3, { status: 'IN_PROGRESS', thru: 12 }),
    ], 'feed', 4);

    const [round] = await store.golfRoundRepo().findBySportEventParticipants([anaEntry.id]);
    expect(round.golf).toMatchObject({ scoreToPar: -3, thru: 12 });
    expect((await standingOf(store, anaEntry.id)).golf).toMatchObject({ eventScoreToPar: -3, currentRoundThru: 12 });
  });
});

describe('golf provider sync — change reporting', () => {
  it('reports a first sync as created and an identical re-sync as unchanged, for rounds and standings alike', async () => {
    const { service, event } = await setup();
    const payload = [update('ext-ana', 1, -2), update('ext-ben', 1, 1)];

    const first = await service.persistRoundUpdatesForSportEvent(event.id, payload, 'feed', 4);
    const second = await service.persistRoundUpdatesForSportEvent(event.id, payload, 'feed', 4);

    expect(first.writeDiagnostics.summary).toMatchObject({ total: 4, created: 4, updated: 0, unchanged: 0 });
    expect(second.writeDiagnostics.summary).toMatchObject({ total: 4, created: 0, updated: 0, unchanged: 4 });
  });

  it('reports a changed score as an update to both the round and the golfer\'s standing', async () => {
    const { service, event } = await setup();
    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2, { status: 'IN_PROGRESS', thru: 10 })], 'feed', 4);

    const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -3, { status: 'IN_PROGRESS', thru: 11 })], 'feed', 4);

    expect(result.writeDiagnostics.summary).toMatchObject({ total: 2, created: 0, updated: 2, unchanged: 0 });
    expect(result.writeDiagnostics.rows.map((row) => [row.entityType, row.disposition])).toEqual([
      ['SportEventParticipantGolfRound', 'UPDATED'],
      ['SportEventParticipantGolfStanding', 'UPDATED'],
    ]);
  });
});

describe('golf standings — cut, withdrawal and the current round', () => {
  it('reads a golfer who missed the cut after round 2 as ELIMINATED, totals their two rounds, and leaves them unranked', async () => {
    const { store, service, event, anaEntry, benEntry } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, 2), update('ext-ana', 2, 3, { status: 'MISSED_CUT' }),
      update('ext-ben', 1, 4), update('ext-ben', 2, 4), update('ext-ben', 3, 4),
    ], 'feed', 4);

    const ana = await standingOf(store, anaEntry.id);
    expect(ana.standing).toMatchObject({ status: 'ELIMINATED', currentRound: 2, position: null, displayPosition: null });
    expect(ana.golf).toMatchObject({ eventScoreToPar: 5, eventStrokes: 149 });
    expect((await standingOf(store, benEntry.id)).standing).toMatchObject({ position: 1, displayPosition: '1' });
  });

  it.each(['DNF', 'DSQ'] as const)('reads a golfer whose latest round is %s as WITHDRAWN and leaves them unranked', async (status) => {
    const { store, service, event, anaEntry, benEntry } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -6), update('ext-ana', 2, -1, { status, thru: 7 }),
      update('ext-ben', 1, 2), update('ext-ben', 2, 2),
    ], 'feed', 4);

    expect((await standingOf(store, anaEntry.id)).standing).toMatchObject({ status: 'WITHDRAWN', position: null });
    expect((await standingOf(store, benEntry.id)).standing).toMatchObject({ status: 'COMPLETE', position: 1, displayPosition: '1' });
  });

  it('reads a golfer between rounds as COMPLETE through 18, and on the first tee of the next round as thru 0', async () => {
    const { store, service, event, anaEntry } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -1, { thru: undefined })], 'feed', 4);
    expect(await standingOf(store, anaEntry.id)).toMatchObject({
      standing: { status: 'COMPLETE', currentRound: 1 },
      golf: { currentRoundThru: 18 },
    });

    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 2, 0, { status: 'IN_PROGRESS', thru: 0, strokes: 0 })], 'feed', 4);
    expect(await standingOf(store, anaEntry.id)).toMatchObject({
      standing: { status: 'IN_PROGRESS', currentRound: 2 },
      golf: { currentRoundThru: 0, eventScoreToPar: -1 },
    });
  });

  it('leaves the current round unknown-through for an in-progress round the feed sent without thru', async () => {
    const { store, service, event, anaEntry } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -1, { status: 'IN_PROGRESS', thru: undefined })], 'feed', 4);

    expect((await standingOf(store, anaEntry.id)).golf.currentRoundThru).toBeNull();
  });
});

describe('golf corrections — moving a golfer in or out of the ranking', () => {
  it('a correction that turns a missed cut back into a completed round ranks the golfer again', async () => {
    const { store, service, event, anaEntry, benEntry } = await setup();
    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -1), update('ext-ana', 2, -1, { status: 'MISSED_CUT' }),
      update('ext-ben', 1, 1), update('ext-ben', 2, 1),
    ], 'feed', 4);
    expect((await standingOf(store, anaEntry.id)).standing.position).toBeNull();

    await service.updateRoundScore(event.id, 2, anaEntry.id, { status: 'COMPLETED' });

    expect((await standingOf(store, anaEntry.id)).standing).toMatchObject({ status: 'COMPLETE', position: 1, displayPosition: '1' });
    expect((await standingOf(store, benEntry.id)).standing).toMatchObject({ position: 2, displayPosition: '2' });
  });

  it('a status-only correction keeps the round\'s stored strokes, to par and thru', async () => {
    const { store, service, event, anaEntry } = await setup();
    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2, { status: 'IN_PROGRESS', thru: 14 })], 'feed', 4);

    await service.updateRoundScore(event.id, 1, anaEntry.id, { status: 'DNF' });

    const [round] = await store.golfRoundRepo().findBySportEventParticipants([anaEntry.id]);
    expect(round).toMatchObject({ participantRound: { status: 'DNF' }, golf: { strokes: 70, scoreToPar: -2, thru: 14 } });
    expect((await standingOf(store, anaEntry.id)).standing.status).toBe('WITHDRAWN');
  });

  it('a correction that sends thru as null clears it, while omitting thru keeps it', async () => {
    const { store, service, event, anaEntry } = await setup();
    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2, { status: 'IN_PROGRESS', thru: 14 })], 'feed', 4);

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 69, scoreToPar: -3 });
    let [round] = await store.golfRoundRepo().findBySportEventParticipants([anaEntry.id]);
    expect(round.golf.thru).toBe(14);

    await service.updateRoundScore(event.id, 1, anaEntry.id, { thru: null });
    [round] = await store.golfRoundRepo().findBySportEventParticipants([anaEntry.id]);
    expect(round.golf.thru).toBeNull();
  });

  it('correcting an earlier round changes the event total but keeps the golfer on their latest round', async () => {
    const { store, service, event, anaEntry } = await setup();
    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -2), update('ext-ana', 2, 0), update('ext-ana', 3, -1, { status: 'IN_PROGRESS', thru: 6 }),
    ], 'feed', 4);

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 72, scoreToPar: 0 });

    expect(await standingOf(store, anaEntry.id)).toMatchObject({
      standing: { currentRound: 3, status: 'IN_PROGRESS' },
      golf: { eventScoreToPar: -1, currentRoundThru: 6 },
    });
  });

  it('a bulk apply in which every row lacks strokes writes no round and no standing', async () => {
    const { store, service, event } = await setup();

    await service.applyRoundScores(event.id, 1, [
      { playerName: 'Ana Park', strokes: null, scoreToPar: -2, status: 'COMPLETED' },
      { playerName: 'Ben Cole', strokes: null, scoreToPar: 1, status: 'COMPLETED' },
    ]);

    expect(store.golfRoundRows).toEqual([]);
    await expect(store.golfStandingRepo().findBySportEvent(event.id)).resolves.toEqual([]);
  });

  it('previews a named golfer who is not on this event\'s field as unresolved, so apply refuses it', async () => {
    const { store, service, event, sport } = await setup();
    store.addParticipant(sport.id, 'Dan Outsider');

    const [preview] = await service.previewRoundScores(event.id, 1, [{ playerName: 'Dan Outsider', strokes: 70, scoreToPar: -2, status: 'COMPLETED' }]);

    expect(preview).toMatchObject({ resolution: 'UNRESOLVED', sportEventParticipantId: null, participantName: null });
    await expect(service.applyRoundScores(event.id, 1, [{ playerName: 'Dan Outsider', strokes: 70, scoreToPar: -2, status: 'COMPLETED' }]))
      .rejects.toMatchObject({ code: 'ROUND_SCORE_ROWS_UNRESOLVED' });
  });
});
