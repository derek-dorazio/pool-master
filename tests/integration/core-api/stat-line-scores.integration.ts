import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ParticipantRoundStatus, ProviderGameState, ScoringFamily, Sport, type SportStat } from '@poolmaster/shared/domain';
import type { StatLineGameUpdate } from '@poolmaster/shared/dto';
import { publishLiveScoreUpdate } from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import { scoringFamilyForEvent } from '../../../packages/core-api/src/modules/scoring-families/registry';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { recordStatements, statementCounts } from '../statement-log';

// A provider's box scores written into a Clutch Card event against real Postgres (#1497): the
// composite family's STAT_LINE writer, through the stat line service, with each star's provider
// mapping deciding whose line it is. No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const PROVIDER = 'balldontlie';

/**
 * An in-progress NBA Finals on the provider, of seven games, with two stars mapped to provider
 * players `bdl-ace` and `bdl-blaze`, and one more mapped player who is not in its field.
 */
async function linkedFinals() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  // cleanupTestData clears the sports table, the migration's reference row with it.
  const basketball = await prisma.sport.upsert({
    where: { sport: Sport.BASKETBALL },
    create: { sport: Sport.BASKETBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const finals = await prisma.sportLeague.create({
    data: { sportId: basketball.id, name: `NBA Finals ${suffix}`, participantType: 'INDIVIDUAL', scoringFamily: ScoringFamily.COMPOSITE },
  });
  const series = await prisma.eventSeries.create({ data: { sportLeagueId: finals.id, name: `NBA Finals ${suffix}` } });
  const externalId = `nba-2025-finals-${suffix}`;
  const event = await prisma.sportEvent.create({
    data: {
      eventSeriesId: series.id,
      eventYear: 2026,
      externalId,
      providerId: PROVIDER,
      sport: Sport.BASKETBALL,
      name: `NBA Finals ${suffix}`,
      startDate: new Date('2026-06-04T00:30:00.000Z'),
      status: 'IN_PROGRESS',
      rounds: 7,
      syncScope: 'SCORES_ONLY',
    },
  });
  await prisma.sportEventRound.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((roundNumber) => ({ sportEventId: event.id, roundNumber, scheduledDate: new Date(Date.UTC(2026, 5, 2 + roundNumber * 2)) })),
  });
  const player = async (name: string, inField: boolean) => {
    const participant = await prisma.participant.create({ data: { sportId: basketball.id, name: `${name} ${suffix}`, participantType: 'INDIVIDUAL' } });
    await prisma.participantProviderMapping.create({ data: { participantId: participant.id, providerId: PROVIDER, externalId: `bdl-${name.toLowerCase()}` } });
    return inField ? prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } }) : null;
  };
  const ace = await player('Ace', true);
  const blaze = await player('Blaze', true);
  await player('Outsider', false);
  return { event, externalId, ace: ace as NonNullable<typeof ace>, blaze: blaze as NonNullable<typeof blaze> };
}

function boxScore(gameNumber: number, state: ProviderGameState, lines: Record<string, Partial<Record<SportStat, number>>>): StatLineGameUpdate {
  return {
    externalGameId: `g${gameNumber}`,
    gameNumber,
    state,
    lines: Object.entries(lines).map(([player, stats]) => ({
      participantExternalId: player,
      stats: Object.entries(stats).map(([stat, value]) => ({ stat: stat as SportStat, value })),
    })),
  };
}

function publish(externalEventId: string, games: StatLineGameUpdate[]) {
  return publishLiveScoreUpdate(
    { category: 'STAT_LINE', externalEventId, games },
    { prisma: getAppPrisma(), providerId: PROVIDER, scoringFamilyForEvent },
  );
}

/** Each stored line of the event as [participant round's entry, game, status, completed?, {stat: value}]. */
async function storedLines(sportEventId: string) {
  const rounds = await getPrisma().sportEventParticipantRound.findMany({
    where: { sportEventRound: { sportEventId } },
    include: { sportEventRound: true, statLines: true },
    orderBy: [{ sportEventRound: { roundNumber: 'asc' } }, { createdAt: 'asc' }],
  });
  return rounds.map((round) => [
    round.sportEventParticipantId,
    round.sportEventRound.roundNumber,
    round.status,
    round.completedAt !== null,
    Object.fromEntries(round.statLines.map((line) => [line.stat, line.value])),
  ]);
}

describe('box scores from a provider', () => {
  it('stores a final game\'s lines completed and a live game\'s in progress for the event\'s stars only', async () => {
    const { event, externalId, ace, blaze } = await linkedFinals();

    const result = await publish(externalId, [
      boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': { POINTS: 31, REBOUNDS: 8, ASSISTS: 5 }, 'bdl-blaze': { POINTS: 12, REBOUNDS: 3, ASSISTS: 9 }, 'bdl-outsider': { POINTS: 2 } }),
      boxScore(2, ProviderGameState.IN_PROGRESS, { 'bdl-ace': { POINTS: 10 }, 'bdl-bench': { POINTS: 4 } }),
    ]);

    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 2, updatesSkipped: 0 });
    expect(result.writeDiagnostics.summary).toMatchObject({ total: 3, created: 3 });
    expect(await storedLines(event.id)).toEqual([
      [ace.id, 1, ParticipantRoundStatus.COMPLETED, true, { POINTS: 31, REBOUNDS: 8, ASSISTS: 5 }],
      [blaze.id, 1, ParticipantRoundStatus.COMPLETED, true, { POINTS: 12, REBOUNDS: 3, ASSISTS: 9 }],
      [ace.id, 2, ParticipantRoundStatus.IN_PROGRESS, false, { POINTS: 10 }],
    ]);
  });

  it('completes a live game\'s lines when a later sync calls it final, and writes nothing when the same box score arrives again', async () => {
    const { event, externalId, ace } = await linkedFinals();
    await publish(externalId, [boxScore(1, ProviderGameState.IN_PROGRESS, { 'bdl-ace': { POINTS: 10 } })]);

    const final = await publish(externalId, [boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': { POINTS: 33 } })]);
    const again = await publish(externalId, [boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': { POINTS: 33 } })]);

    expect(final).toMatchObject({ updatesPersisted: 1 });
    expect(again).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
    expect(again.writeDiagnostics.summary).toMatchObject({ total: 1, unchanged: 1 });
    expect(await storedLines(event.id)).toEqual([[ace.id, 1, ParticipantRoundStatus.COMPLETED, true, { POINTS: 33 }]]);
  });

  it('writes a sync of every game in a fixed handful of statements, however many games and players it carries', async () => {
    const { externalId } = await linkedFinals();
    const games = [1, 2, 3, 4].map((gameNumber) => boxScore(gameNumber, ProviderGameState.FINAL, {
      'bdl-ace': { POINTS: 20 + gameNumber, REBOUNDS: 5, ASSISTS: 4 },
      'bdl-blaze': { POINTS: 10 + gameNumber, REBOUNDS: 2, ASSISTS: 7 },
    }));

    const { statements } = await recordStatements(() => publish(externalId, games));

    // Pinned: the publisher's read of the event, the writer's one read each of the field and the
    // stars' mappings, the stat line service's reads of the event, its games and its field, then
    // one read of the stored lines and one bulk insert each of rounds and lines. A new statement
    // here is a new cost on every sync of a live Clutch Card.
    expect(statementCounts(statements)).toEqual([
      ['INSERT sport_event_participant_rounds', 1],
      ['INSERT sport_event_participant_stat_lines', 1],
      ['SELECT event_series', 2],
      ['SELECT participant_provider_mappings', 1],
      ['SELECT sport_event_participant_rounds', 1],
      ['SELECT sport_event_participants', 2],
      ['SELECT sport_event_rounds', 1],
      ['SELECT sport_events', 2],
      ['SELECT sport_leagues', 2],
    ]);
  });

  it('rewrites a live sync\'s changed lines, completing a game that went final, in a fixed handful of statements', async () => {
    const { externalId } = await linkedFinals();
    const line = (points: number) => ({ POINTS: points, REBOUNDS: 5, ASSISTS: 4 });
    await publish(externalId, [
      boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': line(30), 'bdl-blaze': line(20) }),
      boxScore(2, ProviderGameState.IN_PROGRESS, { 'bdl-ace': line(10), 'bdl-blaze': line(8) }),
      boxScore(3, ProviderGameState.IN_PROGRESS, { 'bdl-ace': line(2), 'bdl-blaze': line(1) }),
    ]);

    // Game 1 unchanged, game 2 goes final, game 3 moves on live.
    const { result, statements } = await recordStatements(() => publish(externalId, [
      boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': line(30), 'bdl-blaze': line(20) }),
      boxScore(2, ProviderGameState.FINAL, { 'bdl-ace': line(25), 'bdl-blaze': line(18) }),
      boxScore(3, ProviderGameState.IN_PROGRESS, { 'bdl-ace': line(6), 'bdl-blaze': line(3) }),
    ]));

    expect(result.writeDiagnostics.summary).toMatchObject({ total: 6, unchanged: 2, updated: 4 });
    // Pinned: the same reads as a first sync and the stored lines with their rounds, then one
    // delete of the changed lines, one update per status the rewritten rounds take (completed,
    // still live) and one insert of their lines. A live Clutch Card runs this every few minutes.
    expect(statementCounts(statements)).toEqual([
      ['DELETE sport_event_participant_stat_lines', 1],
      ['INSERT sport_event_participant_stat_lines', 1],
      ['SELECT event_series', 2],
      ['SELECT participant_provider_mappings', 1],
      ['SELECT sport_event_participant_rounds', 1],
      ['SELECT sport_event_participant_stat_lines', 1],
      ['SELECT sport_event_participants', 2],
      ['SELECT sport_event_rounds', 1],
      ['SELECT sport_events', 2],
      ['SELECT sport_leagues', 2],
      ['UPDATE sport_event_participant_rounds', 2],
    ]);
  });
});
