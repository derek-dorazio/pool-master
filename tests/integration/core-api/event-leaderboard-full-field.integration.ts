/**
 * The event leaderboard read at full size (`rules/testing-rules.md` §9B): a golf tournament's
 * field, 150 golfers through four rounds, read through the API in real Postgres. Twenty rows hide
 * a read that costs per round or per side; the standings come from one query and every round's
 * Game side results from one event-wide query, so the read costs the same exact statements for
 * 150 golfers as for 2. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { GameSideStatus, ParticipantStandingStatus, SportEventStatus } from '@poolmaster/shared/domain';
import { SportEventParticipantListResponseSchema } from '@poolmaster/shared/dto';
import { PrismaFieldGameRepository } from '../../../packages/core-api/src/adapters';
import { cleanupTestData, createTestUser, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { get, okBody, seedEventWithField } from '../list-route-seeds';
import { recordStatements, statementCounts } from '../statement-log';
import { writeGolfRounds } from '../golf-rounds';
import { oneEventSlotId } from '../../support/test-slots';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const ROUNDS = [1, 2, 3, 4] as const;
const FULL_FIELD = 150;
const SMALL_FIELD = 2;
/** The exact statements the read sends, whatever the field's size and however many rounds are scored. */
const EVENT_LEADERBOARD_STATEMENTS = 28;

/** An in-progress golf event of `golfers`, every one scored through four rounds with a standing. */
async function scoredTournament(golfers: number) {
  const prisma = getPrisma();
  const { event, field } = await seedEventWithField(golfers, { startsInDays: -3, status: SportEventStatus.IN_PROGRESS });
  const sportEventSlotId = await oneEventSlotId(prisma, event.id);
  await prisma.sportEventRound.createMany({
    data: ROUNDS.map((roundNumber) => ({ sportEventId: event.id, sportEventSlotId, roundNumber, scheduledDate: new Date(event.startDate.getTime() + (roundNumber - 1) * 86_400_000) })),
  });
  await writeGolfRounds(getAppPrisma(), event.id, ROUNDS.map((roundNumber) => ({
    roundNumber,
    completedAt: new Date(),
    scores: field.map((row, index) => ({ sportEventParticipantId: row.id, strokes: 68 + (index % 6), scoreToPar: (index % 6) - 4, status: GameSideStatus.FINISHED })),
  })));
  await new PrismaFieldGameRepository(getAppPrisma()).applyResults(event.id, {
    games: [],
    standings: field.map((row, index) => ({
      sportEventParticipantId: row.id, position: index + 1, displayPosition: String(index + 1), status: ParticipantStandingStatus.ACTIVE, asOf: new Date(), total: 280 + index, scoreToPar: index - 8,
    })),
  });
  return { event, viewer: await createTestUser({ displayName: `Gallery ${randomUUID().slice(0, 6)}` }) };
}

describe('the event leaderboard read at full size', () => {
  it('reads a 150-golfer, four-round tournament\'s field, every golfer\'s standing and four rounds shown, in the same exact statements as a two-golfer one', async () => {
    const runs = [];
    for (const golfers of [SMALL_FIELD, FULL_FIELD]) {
      // poolmaster-allow-query-in-loop: one fixture tournament per field size, read once each
      const { event, viewer } = await scoredTournament(golfers);
      // poolmaster-allow-query-in-loop: one read per field size, the read being measured
      const { result, statements } = await recordStatements(() => get(`/api/v1/events/${event.id}/participants`, viewer));
      const { participants } = okBody(result, SportEventParticipantListResponseSchema);
      expect(participants).toHaveLength(golfers);
      expect(participants.every((row) => row.standing !== null && row.rounds.map((round) => round.roundNumber).join() === ROUNDS.join())).toBe(true);
      runs.push(statementCounts(statements));
    }

    expect(runs[1]).toEqual(runs[0]);
    // The standings from one query, and every round's side results from one event-wide query.
    expect(runs[0]).toEqual(expect.arrayContaining([['SELECT sport_event_participant_standings', 1], ['SELECT sport_event_round_match_game_side_results', 1]]));
    expect(runs[0]?.reduce((sum, [, count]) => sum + count, 0)).toBe(EVENT_LEADERBOARD_STATEMENTS);
  }, 120_000);
});
