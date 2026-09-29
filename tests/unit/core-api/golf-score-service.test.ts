import { Sport } from '@poolmaster/shared/domain';
import { GolfScoreService } from '../../../packages/core-api/src/modules/golf/golf-score-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// The golf score-correction rules against an in-memory store: what a preview reports, that
// apply is all or none, how a correction merges, and how a standing is totalled. The sync
// path's writes against Postgres are in golf-round-scores.integration.

function setup() {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.GOLF);
  const event = store.addEvent({ providerId: 'feed' });
  const ana = store.addParticipant(sport.id, 'Ana Park', { externalId: 'ext-ana' });
  const ben = store.addParticipant(sport.id, 'Ben Cole');
  const anaEntry = store.addToField(event.id, ana.id);
  const benEntry = store.addToField(event.id, ben.id);
  const bus = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new GolfScoreService({
    sportEvents: store.sportEventRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    participants: store.participantRepo(),
    mappings: store.mappingRepo(),
    golfRounds: store.golfRoundRepo(),
    golfStandings: store.golfStandingRepo(),
    bus: bus as never,
  });
  return { store, service, event, anaEntry, benEntry, bus };
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
});

describe('GolfScoreService — apply', () => {
  it('writes nothing when any row is unresolved, 422 ROUND_SCORE_ROWS_UNRESOLVED', async () => {
    const { store, service, event } = setup();

    await expect(service.applyRoundScores(event.id, 1, [{ playerName: 'Ana Park', ...row() }, { playerName: 'Nobody', ...row() }]))
      .rejects.toMatchObject({ code: 'ROUND_SCORE_ROWS_UNRESOLVED', statusCode: 422 });
    expect(store.golfRoundRows).toEqual([]);
  });

  it('creates the round if needed, skips rows with no strokes, totals each standing, and publishes the persisted event', async () => {
    const { store, service, event, anaEntry, bus } = setup();

    await service.applyRoundScores(event.id, 1, [{ playerName: 'Ana Park', ...row() }, { playerName: 'Ben Cole', ...row({ strokes: null }) }]);
    await service.applyRoundScores(event.id, 2, [{ playerName: 'Ana Park', ...row({ strokes: 68, scoreToPar: -4, status: 'IN_PROGRESS', thru: 9 }) }]);

    expect(store.roundRows.map((round) => round.roundNumber)).toEqual([1, 2]);
    expect(store.golfRoundRows).toHaveLength(2);
    const [standing] = await store.golfStandingRepo().findBySportEventParticipants([anaEntry.id]);
    expect(standing).toMatchObject({
      standing: { currentRound: 2, status: 'IN_PROGRESS' },
      golf: { eventScoreToPar: -6, eventStrokes: 138, currentRoundThru: 9 },
    });
    expect(bus.publish).toHaveBeenCalledWith('live_score.persisted', expect.objectContaining({ sportEventId: event.id, providerId: 'feed', updatesPersisted: 1 }));
  });

  it('marks a golfer who missed the cut ELIMINATED on the cross-sport standing', async () => {
    const { service, store, event, anaEntry } = setup();

    await service.applyRoundScores(event.id, 1, [{ playerName: 'Ana Park', ...row({ status: 'MISSED_CUT' }) }]);

    const [standing] = await store.golfStandingRepo().findBySportEventParticipants([anaEntry.id]);
    expect(standing.standing.status).toBe('ELIMINATED');
  });
});

describe('GolfScoreService — single-cell correction', () => {
  it('changes only what is patched, keeping the rest of the stored round', async () => {
    const { service, store, event, anaEntry } = setup();
    await service.applyRoundScores(event.id, 1, [{ playerName: 'Ana Park', ...row() }]);

    await service.updateRoundScore(event.id, 1, anaEntry.id, { strokes: 71 });

    const [result] = await store.golfRoundRepo().findBySportEventParticipants([anaEntry.id]);
    expect(result).toMatchObject({ participantRound: { status: 'COMPLETED' }, golf: { strokes: 71, scoreToPar: -2, thru: 18 } });
  });

  it('refuses a field row that is not on this event with 404 EVENT_PARTICIPANT_NOT_FOUND', async () => {
    const { service, event } = setup();

    await expect(service.updateRoundScore(event.id, 1, 'missing', { strokes: 70 }))
      .rejects.toMatchObject({ code: 'EVENT_PARTICIPANT_NOT_FOUND', statusCode: 404 });
  });
});
