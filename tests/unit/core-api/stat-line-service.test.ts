import { ScoringFamily, Sport, SportStat } from '@poolmaster/shared/domain';
import type { FastifyBaseLogger } from 'fastify';
import { StatLineService } from '../../../packages/core-api/src/modules/scoring-families/composite/stat-line-service';
import { expectDefined } from '../../support/expect-defined';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// One game's stat lines for a composite-scored event (#935) against an in-memory store: what is
// refused before anything is written, that a valid game's rows land in one write, and that a
// player not named keeps their line. The Prisma adapter's writes are covered by integration.

const NOW = new Date('2026-10-30T03:00:00.000Z');

async function setup(overrides: { scoringFamily?: ScoringFamily | null; sport?: Sport } = {}) {
  const store = new InMemorySportEvents();
  const sport = overrides.sport ?? Sport.BASEBALL;
  const sportRow = store.addSport(sport);
  const event = store.addEvent({
    sport,
    name: 'World Series',
    scoringFamily: overrides.scoringFamily === undefined ? ScoringFamily.COMPOSITE : overrides.scoringFamily,
  });
  await store.addRounds(event.id, [
    { roundNumber: 1, scheduledDate: new Date('2026-10-24T00:00:00.000Z') },
    { roundNumber: 2, scheduledDate: new Date('2026-10-25T00:00:00.000Z') },
  ]);
  const [ace, bat] = ['Ace', 'Bat'].map((name) => store.addToField(event.id, store.addParticipant(sportRow.id, name).id));
  const info = jest.fn();
  const service = new StatLineService({
    events: store.sportEventRepo(),
    rounds: store.roundRepo(),
    field: store.fieldRepo(),
    statLines: store.statLineRepo(),
    now: () => NOW,
    logger: { info } as unknown as FastifyBaseLogger,
  });
  return { store, service, event, ace: ace, bat: bat, info };
}

describe('StatLineService.applyGameLines — refusals', () => {
  it('refuses an unknown event with 404 SPORT_EVENT_NOT_FOUND', async () => {
    const { service } = await setup();
    await expect(service.applyGameLines('no-such-event', 1, [])).rejects.toMatchObject({
      name: 'StatLineError', code: 'SPORT_EVENT_NOT_FOUND', statusCode: 404,
    });
  });

  it('refuses an event its sport scores by another family with 422 EVENT_SCORING_FAMILY_MISMATCH, naming the family', async () => {
    const { service, event, ace } = await setup({ scoringFamily: null });
    const failure = service.applyGameLines(event.id, 1, [{ participantId: ace.participantId, stats: [] }]);
    await expect(failure).rejects.toMatchObject({ code: 'EVENT_SCORING_FAMILY_MISMATCH', statusCode: 422 });
    await expect(failure).rejects.toThrow('HEAD_TO_HEAD');
  });

  it('refuses a game the event does not schedule with 422 ROUND_BEYOND_SCHEDULE', async () => {
    const { service, event } = await setup();
    await expect(service.applyGameLines(event.id, 3, [])).rejects.toMatchObject({ code: 'ROUND_BEYOND_SCHEDULE', statusCode: 422 });
  });

  it('refuses the whole game with 422 STAT_LINE_ROWS_INVALID naming every problem, and writes no line', async () => {
    const { store, service, event, ace } = await setup();
    const rows = [
      { participantId: ace.participantId, stats: [{ stat: SportStat.RUNS, value: 1 }, { stat: SportStat.RUNS, value: 2 }] },
      { participantId: ace.participantId, stats: [{ stat: SportStat.POINTS, value: 3 }] },
      { participantId: 'stranger', stats: [{ stat: SportStat.WALKS, value: -1 }] },
    ];

    const failure = service.applyGameLines(event.id, 1, rows);

    await expect(failure).rejects.toMatchObject({ code: 'STAT_LINE_ROWS_INVALID', statusCode: 422 });
    const message = await failure.then(() => '', (error: unknown) => (error instanceof Error ? error.message : String(error)));
    expect(message).toContain(`participant ${ace.participantId}: RUNS is given more than once`);
    expect(message).toContain(`participant ${ace.participantId} is named more than once`);
    expect(message).toContain(`participant ${ace.participantId}: POINTS is not a stat the`);
    expect(message).toContain('participant stranger is not in the field');
    expect(message).toContain('participant stranger: WALKS is -1; only yards go below 0');
    expect(store.statLineRows).toEqual([]);
  });

  it('accepts negative yards for a sport whose composite counts yards', async () => {
    const { store, service, event, ace } = await setup({ sport: Sport.AMERICAN_FOOTBALL });
    await service.applyGameLines(event.id, 1, [{ participantId: ace.participantId, stats: [{ stat: SportStat.RUSHING_YARDS, value: -4 }] }]);
    expect(store.statLineRows.map((row) => [row.stat, row.value])).toEqual([[SportStat.RUSHING_YARDS, -4]]);
  });
});

describe('StatLineService.applyGameLines — stores the game', () => {
  it('stores each named player line exactly as sent on the game, completed now, and logs the write', async () => {
    const { store, service, event, ace, bat, info } = await setup();

    await service.applyGameLines(event.id, 2, [
      { participantId: ace.participantId, stats: [{ stat: SportStat.RUNS, value: 2 }, { stat: SportStat.TOTAL_BASES, value: 5 }] },
      { participantId: bat.participantId, stats: [{ stat: SportStat.WALKS, value: 1 }] },
    ]);

    expect(store.participantRoundRows.map((row) => [row.sportEventParticipantId, store.roundNumberOf(row.sportEventRoundId), row.completedAt]))
      .toEqual([[ace.id, 2, NOW], [bat.id, 2, NOW]]);
    expect(store.statLineRows.map((row) => [row.stat, row.value])).toEqual([
      [SportStat.RUNS, 2], [SportStat.TOTAL_BASES, 5], [SportStat.WALKS, 1],
    ]);
    expect(info).toHaveBeenCalledWith(
      { action: 'statLines.gameApplied', data: { sportEventId: event.id, roundNumber: 2, players: 2 } },
      expect.any(String),
    );
  });

  it('replaces a corrected player line and leaves a player not named with theirs', async () => {
    const { store, service, event, ace, bat } = await setup();
    await service.applyGameLines(event.id, 1, [
      { participantId: ace.participantId, stats: [{ stat: SportStat.RUNS, value: 1 }] },
      { participantId: bat.participantId, stats: [{ stat: SportStat.RUNS, value: 3 }] },
    ]);

    await service.applyGameLines(event.id, 1, [{ participantId: ace.participantId, stats: [{ stat: SportStat.RUNS, value: 2 }] }]);

    expect(store.statLineRows.map((row) => row.value).sort((left, right) => left - right)).toEqual([2, 3]);
  });

  it('stamps the current time when no clock is given and runs without a logger', async () => {
    const store = new InMemorySportEvents();
    const sportRow = store.addSport(Sport.BASEBALL);
    const event = store.addEvent({ sport: Sport.BASEBALL, scoringFamily: ScoringFamily.COMPOSITE });
    await store.addRounds(event.id, [{ roundNumber: 1, scheduledDate: event.startDate }]);
    const ace = store.addToField(event.id, store.addParticipant(sportRow.id, 'Ace').id);
    const service = new StatLineService({
      events: store.sportEventRepo(), rounds: store.roundRepo(), field: store.fieldRepo(), statLines: store.statLineRepo(),
    });
    const before = Date.now();

    await service.applyGameLines(event.id, 1, [{ participantId: ace.participantId, stats: [{ stat: SportStat.RUNS, value: 1 }] }]);

    expect(expectDefined(store.participantRoundRows[0].completedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});
