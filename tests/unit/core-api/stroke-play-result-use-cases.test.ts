import { testDomainEvents } from '../../support/domain-events';
import { PeriodUnit, Sport } from '@poolmaster/shared/domain';
import { StrokePlayResultService } from '../../../packages/core-api/src/modules/scoring-families/stroke-play/stroke-play-result-service';
import { eventStoresGolfRoundScores } from '../../../packages/core-api/src/modules/scoring-families/golf-round-scores';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { fakeLogger } from '../../support/fake-logger';
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';

/** A test participant's id, fixed by its name, so a row names it by id as the feed does (#2114). */
const idOf = (name: string): string => `participant-${name.toLowerCase().replace(/\s+/g, '-')}`;

// Golf scoring use cases beyond stroke-play-result-service.test.ts: the provider sync's skip paths and
// change reporting, how a cut or withdrawn golfer's standing reads, and corrections that move a
// golfer in or out of the ranking.

async function setup() {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.GOLF);
  const event = store.addEvent({ providerRef: { providerId: 'balldontlie', externalId: 'golf-event-1' } });
  // Its rounds are played in its one slot, of 18 holes a round.
  store.slotPeriods.set(store.eventSlotOf(event.id).id, { unit: PeriodUnit.HOLE, count: 18 });
  await store.addRounds(event.id, [1, 2, 3, 4].map((roundNumber) => ({
    roundNumber,
    scheduledDate: new Date('2026-06-04T12:00:00.000Z'),
  })));
  const ana = store.addParticipant(sport.id, 'Ana Park', { id: idOf('Ana Park') });
  const ben = store.addParticipant(sport.id, 'Ben Cole', { id: idOf('Ben Cole') });
  const cara = store.addParticipant(sport.id, 'Cara Diaz', { id: idOf('Cara Diaz') });
  const anaEntry = store.addToField(event.id, ana.id);
  const benEntry = store.addToField(event.id, ben.id);
  const caraEntry = store.addToField(event.id, cara.id);
  const mappedAt = new Date('2026-06-01T12:00:00.000Z');
  for (const [externalId, participantId] of [['ext-ana', ana.id], ['ext-ben', ben.id], ['ext-cara', cara.id]]) {
    await store.mappingRepo().bind({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId, participantId, sportLeagueId: store.leagueOf(participantId), participantType: 'INDIVIDUAL', mappedAt });
  }
  const logger = fakeLogger();
  const service = new StrokePlayResultService({ domainEvents: testDomainEvents(),
    events: store.sportEventRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    mappings: store.mappingRepo(),
    fieldGames: store.fieldGameRepo(),
    storesGolfRoundScores: eventStoresGolfRoundScores,
    logger,
  });
  return { store, service, event, sport, anaEntry, benEntry, caraEntry, logger };
}

type RoundStatus = 'FINISHED' | 'DID_NOT_FINISH' | 'DISQUALIFIED' | 'DID_NOT_START' | null;
const update = (participantExternalId: string, round: number, scoreToPar: number, overrides: { status?: RoundStatus; missedCut?: boolean; thru?: number; strokes?: number | null } = {}) => ({
  participantExternalId,
  round,
  strokes: 72 + scoreToPar,
  scoreToPar,
  thru: 18,
  status: 'FINISHED' as RoundStatus,
  ...overrides,
});

const standingOf = (store: InMemorySportEvents, sportEventParticipantId: string) =>
  store.standingRows.find((row) => row.sportEventParticipantId === sportEventParticipantId);

/** A golfer's rounds as stored: their side results in the event's FIELD Games, in round order. */
const roundsOf = (store: InMemorySportEvents, sportEventParticipantId: string) => store.fieldSideRows
  .filter((row) => row.sportEventParticipantId === sportEventParticipantId)
  .sort((left, right) => left.roundNumber - right.roundNumber);

describe('golf provider sync — what is skipped', () => {
  it('writes nothing and reports zero for an empty payload', async () => {
    const { store, service, event } = await setup();

    await expect(service.persistRoundUpdatesForSportEvent(event.id, [], 'balldontlie')).resolves.toEqual({
      updatesReturned: 0,
      updatesPersisted: 0,
      updatesSkipped: 0,
      writeDiagnostics: { summary: { total: 0, unchanged: 0, created: 0, updated: 0, deleted: 0 }, rows: [] },
    });
    expect(store.fieldSideRows).toEqual([]);
  });

  it('skips and logs an update for a provider golfer with no mapping, and still stores the others', async () => {
    const { store, service, event, logger } = await setup();

    const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -1), update('ext-stranger', 1, -5)], 'balldontlie');

    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 1, updatesSkipped: 1 });
    expect(store.fieldSideRows).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.unmappedExternalId', data: { providerId: 'balldontlie', sportEventId: event.id, externalIds: ['ext-stranger'] } },
      expect.any(String),
    );
  });

  it('logs every unmapped golfer in a tick on one warning line, each named once, rather than a line per update', async () => {
    const { service, event, logger } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-stranger', 1, -5), update('ext-stranger', 2, -1), update('ext-nobody', 1, 0), update('ext-ana', 1, -1),
    ], 'balldontlie');

    const unmappedLines = logger.warn.mock.calls.filter(([fields]) => (fields as { action?: string }).action === 'liveScore.golf.unmappedExternalId');
    expect(unmappedLines).toEqual([[
      { action: 'liveScore.golf.unmappedExternalId', data: { providerId: 'balldontlie', sportEventId: event.id, externalIds: ['ext-stranger', 'ext-nobody'] } },
      expect.any(String),
    ]]);
  });

  it('skips and logs an update for a mapped golfer who is not on this event\'s field', async () => {
    const { store, service, event, sport, logger } = await setup();
    const outsider = store.addParticipant(sport.id, 'Dan Outsider', { id: idOf('Dan Outsider') });
    await store.mappingRepo().bind({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId: 'ext-dan', participantId: outsider.id, sportLeagueId: outsider.sportLeagueId, participantType: 'INDIVIDUAL', mappedAt: new Date() });

    const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-dan', 1, -3)], 'balldontlie');

    expect(result).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    expect(store.fieldSideRows).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.golf.noSportEventParticipant', data: { participantId: outsider.id, externalId: 'ext-dan', sportEventId: event.id } },
      expect.any(String),
    );
  });

  it('skips an update with no per-round strokes, since a round is never stored without them', async () => {
    const { store, service, event } = await setup();

    const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2, { strokes: null })], 'balldontlie');

    expect(result).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    expect(store.fieldSideRows).toEqual([]);
  });

  it('applies two updates for the same golfer and round in payload order, so the later one is stored', async () => {
    const { store, service, event, anaEntry } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -1, { status: null, thru: 9 }),
      update('ext-ana', 1, -3, { status: null, thru: 12 }),
    ], 'balldontlie');

    expect(roundsOf(store, anaEntry.id)).toEqual([expect.objectContaining({ scoreToPar: -3, periodsCompleted: 12 })]);
    expect(standingOf(store, anaEntry.id)).toMatchObject({ scoreToPar: -3 });
  });
});

describe('golf provider sync — change reporting', () => {
  it('reports a first sync as created and an identical re-sync as unchanged, for rounds and standings alike', async () => {
    const { service, event } = await setup();
    const payload = [update('ext-ana', 1, -2), update('ext-ben', 1, 1)];

    const first = await service.persistRoundUpdatesForSportEvent(event.id, payload, 'balldontlie');
    const second = await service.persistRoundUpdatesForSportEvent(event.id, payload, 'balldontlie');

    expect(first.writeDiagnostics.summary).toMatchObject({ total: 4, created: 4, updated: 0, unchanged: 0 });
    expect(second.writeDiagnostics.summary).toMatchObject({ total: 4, created: 0, updated: 0, unchanged: 4 });
  });

  it('reports a changed score as an update to both the round and the golfer\'s standing', async () => {
    const { service, event } = await setup();
    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2, { status: null, thru: 10 })], 'balldontlie');

    const result = await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -3, { status: null, thru: 11 })], 'balldontlie');

    expect(result.writeDiagnostics.summary).toMatchObject({ total: 2, created: 0, updated: 2, unchanged: 0 });
    expect(result.writeDiagnostics.rows.map((row) => [row.entityType, row.disposition])).toEqual([
      ['SportEventRoundMatchGameSideResult', 'UPDATED'],
      ['SportEventParticipantStanding', 'UPDATED'],
    ]);
  });
});

describe('golf standings — cut, withdrawal and the current round', () => {
  it('reads a golfer who missed the cut after round 2 as ELIMINATED, totals their two rounds, and leaves them unranked', async () => {
    const { store, service, event, anaEntry, benEntry } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, 2), update('ext-ana', 2, 3, { status: 'FINISHED', missedCut: true }),
      update('ext-ben', 1, 4), update('ext-ben', 2, 4), update('ext-ben', 3, 4),
    ], 'balldontlie');

    expect(standingOf(store, anaEntry.id)).toMatchObject({ status: 'ELIMINATED', position: null, displayPosition: null, scoreToPar: 5, total: 149 });
    expect(standingOf(store, benEntry.id)).toMatchObject({ position: 1, displayPosition: '1' });
  });

  it.each(['DID_NOT_FINISH', 'DISQUALIFIED', 'DID_NOT_START'] as const)('reads a golfer whose latest round ended %s as WITHDRAWN and leaves them unranked', async (status) => {
    const { store, service, event, anaEntry, benEntry } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -6), update('ext-ana', 2, -1, { status, thru: 7 }),
      update('ext-ben', 1, 2), update('ext-ben', 2, 2),
    ], 'balldontlie');

    expect(standingOf(store, anaEntry.id)).toMatchObject({ status: 'WITHDRAWN', position: null });
    expect(standingOf(store, benEntry.id)).toMatchObject({ status: 'COMPLETE', position: 1, displayPosition: '1' });
  });

  it('reads a golfer between rounds as COMPLETE through every hole of the round\'s slot (18), and on the first tee of the next round as thru 0', async () => {
    const { store, service, event, anaEntry } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -1, { thru: undefined })], 'balldontlie');
    expect(standingOf(store, anaEntry.id)).toMatchObject({ status: 'COMPLETE' });
    expect(roundsOf(store, anaEntry.id).map((round) => round.periodsCompleted)).toEqual([18]);

    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 2, 0, { status: null, thru: 0, strokes: 0 })], 'balldontlie');
    expect(standingOf(store, anaEntry.id)).toMatchObject({ status: 'IN_PROGRESS', scoreToPar: -1 });
    expect(roundsOf(store, anaEntry.id).map((round) => round.periodsCompleted)).toEqual([18, 0]);
  });

  it('leaves holes thru unknown for an in-progress round the feed sent without thru', async () => {
    const { store, service, event, anaEntry } = await setup();

    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -1, { status: null, thru: undefined })], 'balldontlie');

    expect(roundsOf(store, anaEntry.id).map((round) => round.periodsCompleted)).toEqual([null]);
  });
});

describe('golf corrections — moving a golfer in or out of the ranking', () => {
  it('a correction that turns a missed cut back into a completed round ranks the golfer again', async () => {
    const { store, service, event, anaEntry, benEntry } = await setup();
    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -1), update('ext-ana', 2, -1, { status: 'FINISHED', missedCut: true }),
      update('ext-ben', 1, 1), update('ext-ben', 2, 1),
    ], 'balldontlie');
    expect(standingOf(store, anaEntry.id)?.position).toBeNull();

    await service.updateRoundScore(event.id, 2, anaEntry.id, { status: 'FINISHED' });

    expect(standingOf(store, anaEntry.id)).toMatchObject({ status: 'COMPLETE', position: 1, displayPosition: '1' });
    expect(standingOf(store, benEntry.id)).toMatchObject({ position: 2, displayPosition: '2' });
  });

  it('a status-only correction keeps the round\'s stored strokes, to par and thru', async () => {
    const { store, service, event, anaEntry } = await setup();
    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2, { status: null, thru: 14 })], 'balldontlie');

    await service.updateRoundScore(event.id, 1, anaEntry.id, { status: 'DID_NOT_FINISH' });

    expect(roundsOf(store, anaEntry.id)).toEqual([expect.objectContaining({ status: 'DID_NOT_FINISH', score: 70, scoreToPar: -2, periodsCompleted: 14 })]);
    expect(standingOf(store, anaEntry.id)?.status).toBe('WITHDRAWN');
  });

  it('a correction that sends thru as null clears it, while omitting thru keeps it', async () => {
    const { store, service, event, anaEntry } = await setup();
    await service.persistRoundUpdatesForSportEvent(event.id, [update('ext-ana', 1, -2, { status: null, thru: 14 })], 'balldontlie');

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 69, scoreToPar: -3 });
    expect(roundsOf(store, anaEntry.id).map((round) => round.periodsCompleted)).toEqual([14]);

    await service.updateRoundScore(event.id, 1, anaEntry.id, { thru: null });
    expect(roundsOf(store, anaEntry.id).map((round) => round.periodsCompleted)).toEqual([null]);
  });

  it('correcting an earlier round changes the event total but keeps the golfer on their latest round', async () => {
    const { store, service, event, anaEntry } = await setup();
    await service.persistRoundUpdatesForSportEvent(event.id, [
      update('ext-ana', 1, -2), update('ext-ana', 2, 0), update('ext-ana', 3, -1, { status: null, thru: 6 }),
    ], 'balldontlie');

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 72, scoreToPar: 0 });

    expect(standingOf(store, anaEntry.id)).toMatchObject({ status: 'IN_PROGRESS', scoreToPar: -1 });
    expect(roundsOf(store, anaEntry.id).map((round) => round.periodsCompleted)).toEqual([18, 18, 6]);
  });

  it('a bulk apply in which every row lacks strokes writes no round and no standing', async () => {
    const { store, service, event } = await setup();

    await service.applyRoundScores(event.id, 1, [
      { participantId: idOf('Ana Park'), strokes: null, scoreToPar: -2, status: 'FINISHED' },
      { participantId: idOf('Ben Cole'), strokes: null, scoreToPar: 1, status: 'FINISHED' },
    ]);

    expect(store.fieldSideRows).toEqual([]);
    expect(store.standingRows).toEqual([]);
  });

  it('previews a named golfer who is not on this event\'s field as unresolved, so apply refuses it', async () => {
    const { store, service, event, sport } = await setup();
    store.addParticipant(sport.id, 'Dan Outsider', { id: idOf('Dan Outsider') });

    const [preview] = await service.previewRoundScores(event.id, 1, [{ participantId: idOf('Dan Outsider'), strokes: 70, scoreToPar: -2, status: 'FINISHED' }]);

    expect(preview).toMatchObject({ resolution: 'UNRESOLVED', sportEventParticipantId: null, participantName: null });
    await expect(service.applyRoundScores(event.id, 1, [{ participantId: idOf('Dan Outsider'), strokes: 70, scoreToPar: -2, status: 'FINISHED' }]))
      .rejects.toMatchObject({ code: 'ROUND_SCORE_ROWS_UNRESOLVED' });
  });
});
