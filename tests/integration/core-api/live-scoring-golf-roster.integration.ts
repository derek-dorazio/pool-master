/**
 * End-to-end live-scoring regression for pool-master-rop.78.12 / plans/117
 * §15.1 — the regression detector the audit (Q15) flagged as missing.
 *
 * Folds in pool-master-rop.15. The slice description called for a FAPI
 * scenario, but the venue here is a Postgres-backed integration test:
 * the substrate's correctness comes from in-process bus wiring
 * (live_score.persisted → LiveScoreConsumer → contributions →
 * totalScore → StandingsRollup → standings.updated) rather than from
 * the HTTP boundary, and exercising it with a real bus + real DB is
 * what catches regressions in the pipeline. The HTTP /standings read
 * is asserted at the end so the route-level contract is also locked.
 *
 * The scenario:
 *   - One golf SportEvent with 4 SportEventParticipants (Rory, Tiger,
 *     Jordan, Scottie).
 *   - One ROSTER × GOLF contest with 2 ContestEntries, each with 2
 *     picks (Entry A picks Rory + Tiger; Entry B picks Jordan +
 *     Scottie).
 *   - publishLiveScoreUpdate emits a typed LiveScoreResult with
 *     category 'GOLF' carrying 4 GolfRoundUpdates for round 1.
 *
 * Asserts every pipeline edge:
 *   1. SportEventParticipantGolfRound rows persist (4 rows).
 *   2. live_score.persisted fires with the resolved internal sportEventId.
 *   3. ContestEntryPickGolfRosterContribution rows are written (4 rows
 *      — one per pick).
 *   4. ContestEntry.totalScore = SUM(contribution) per affected entry
 *      (Entry A: -3 + -1 = -4; Entry B: 2 + 0 = 2).
 *   5. Standings rerank using LOWER_IS_BETTER (Entry A rank 1 at -4,
 *      Entry B rank 2 at +2) — golf-roster invariant.
 *   6. standings.updated fires with the reranked leaderboard.
 *   7. HTTP GET /api/v1/contests/:id/standings returns the same order.
 */

import { randomUUID } from 'node:crypto';
import { EventBus } from '@poolmaster/shared/events/event-bus';
import type { LiveScorePersistedEvent } from '@poolmaster/shared/events';
import { ParticipantType, Sport } from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { LiveScoreConsumer } from '../../../packages/core-api/src/modules/scoring/consumer/live-score-consumer';
import { StandingsRollup } from '../../../packages/core-api/src/modules/scoring/rollup/standings-rollup';
import { publishLiveScoreUpdate } from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const PROVIDER_ID = 'integration-test';

interface ScenarioFixture {
  contestId: string;
  sportEventId: string;
  externalEventId: string;
  entryAId: string;
  entryBId: string;
  pickIds: { entryA: string[]; entryB: string[] };
  sportEventParticipantIds: string[];
  // Maps externalId (provider-side) → internal SEP.id, used by the bus boundary.
  externalGolferIds: { rory: string; tiger: string; jordan: string; scottie: string };
}

async function seedScenario(): Promise<ScenarioFixture> {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);

  const { user } = await createTestUser({ displayName: `Live-scoring Owner ${suffix}` });

  const league = await prisma.league.create({
    data: {
      leagueCode: `LSG${suffix.slice(0, 4).toUpperCase()}`,
      name: `Live-scoring League ${suffix}`,
      createdBy: user.id,
      iconKey: 'TROPHY',
      joinPolicy: 'COMMISSIONER_ONLY',
    },
  });
  await prisma.leagueMembership.create({
    data: {
      leagueId: league.id,
      userId: user.id,
      role: 'COMMISSIONER',
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  const squad = await prisma.squad.create({
    data: {
      leagueId: league.id,
      name: `Live-scoring Squad ${suffix}`,
      createdBy: user.id,
    },
  });
  await prisma.squadMembership.create({
    data: {
      leagueId: league.id,
      squadId: squad.id,
      userId: user.id,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });

  // Sport + canonical Participant rows + ParticipantProviderMapping rows
  // wire the provider-side `externalId` to the internal `Participant` row.
  const sport = await prisma.sport.create({
    data: {
      name: `Live-scoring Sport ${suffix}`,
      participantType: ParticipantType.INDIVIDUAL,
    },
  });

  const externalEventId = `live-scoring-event-${suffix}`;
  const sportEvent = await prisma.sportEvent.create({
    data: {
      externalId: externalEventId,
      providerId: PROVIDER_ID,
      sport: Sport.GOLF,
      name: `Live-scoring Event ${suffix}`,
      startDate: new Date('2030-04-01T12:00:00.000Z'),
      releaseAt: new Date('2030-03-25T12:00:00.000Z'),
      fieldLocksAt: new Date('2030-04-01T12:00:00.000Z'),
      status: 'IN_PROGRESS',
    },
  });

  const golferDefs = [
    { externalId: `rory-${suffix}`, name: 'Rory McIlroy' },
    { externalId: `tiger-${suffix}`, name: 'Tiger Woods' },
    { externalId: `jordan-${suffix}`, name: 'Jordan Spieth' },
    { externalId: `scottie-${suffix}`, name: 'Scottie Scheffler' },
  ];
  const seps: { externalId: string; sepId: string }[] = [];
  for (const def of golferDefs) {
    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: def.name,
        participantType: ParticipantType.INDIVIDUAL,
        externalIds: {},
      },
    });
    await prisma.participantProviderMapping.create({
      data: {
        participantId: participant.id,
        providerId: PROVIDER_ID,
        externalId: def.externalId,
      },
    });
    const sep = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: sportEvent.id,
        participantId: participant.id,
        status: 'ACTIVE',
      },
    });
    seps.push({ externalId: def.externalId, sepId: sep.id });
  }

  // ROSTER × GOLF contest with 2 entries × 2 picks each. Picks reference
  // SEP rows directly — pick.contestFormat denormalized to ROSTER.
  const contest = await prisma.contest.create({
    data: {
      leagueId: league.id,
      sportEventId: sportEvent.id,
      name: `Live-scoring Contest ${suffix}`,
      status: 'ACTIVE',
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      scoringEngine: 'STROKE_PLAY',
    },
  });

  async function createEntryWithPicks(entryNumber: number, sepIndices: [number, number]) {
    const entry = await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        squadId: squad.id,
        entryNumber,
        name: `Entry ${entryNumber} ${suffix}`,
        status: 'ACTIVE',
        totalScore: 0,
      },
    });
    const pickIds: string[] = [];
    for (const sepIdx of sepIndices) {
      const pick = await prisma.contestEntryPick.create({
        data: {
          entryId: entry.id,
          sportEventParticipantId: seps[sepIdx].sepId,
          contestFormat: 'ROSTER',
          isAutoPicked: false,
        },
      });
      pickIds.push(pick.id);
    }
    return { entryId: entry.id, pickIds };
  }

  const entryA = await createEntryWithPicks(1, [0, 1]); // Rory + Tiger
  const entryB = await createEntryWithPicks(2, [2, 3]); // Jordan + Scottie

  return {
    contestId: contest.id,
    sportEventId: sportEvent.id,
    externalEventId,
    entryAId: entryA.entryId,
    entryBId: entryB.entryId,
    pickIds: { entryA: entryA.pickIds, entryB: entryB.pickIds },
    sportEventParticipantIds: seps.map((s) => s.sepId),
    externalGolferIds: {
      rory: golferDefs[0].externalId,
      tiger: golferDefs[1].externalId,
      jordan: golferDefs[2].externalId,
      scottie: golferDefs[3].externalId,
    },
  };
}

describe('pool-master-rop.78.12 / plans/117 §15.1 — live-scoring golf-roster pipeline', () => {
  it('persists rounds, scores contributions, recomputes totals, reranks standings, and emits standings.updated', async () => {
    const prisma = getPrisma();
    const fixture = await seedScenario();

    // Wire a fresh EventBus + LiveScoreConsumer in-process. The integration
    // helpers stub the production bus so they don't fire on stray scoring
    // work; this test owns its bus end-to-end.
    const eventBus = new EventBus();
    const standingsRollup = new StandingsRollup({ eventBus, prisma });
    const consumer = new LiveScoreConsumer({ prisma, eventBus, standingsRollup });
    consumer.subscribe();

    const persistedEvents: LiveScorePersistedEvent[] = [];
    eventBus.subscribe<LiveScorePersistedEvent>('live_score.persisted', async (evt) => {
      persistedEvents.push(evt);
    });
    const standingsEvents: Array<{ contestId: string; standings: Array<{ entryId: string; rank: number; totalScore: number; isTied: boolean }> }> = [];
    eventBus.subscribe('standings.updated', async (evt: any) => {
      standingsEvents.push(evt);
    });

    try {
      // Drive the bus boundary with a typed LiveScoreResult — same code path
      // an adapter's getLiveScores → ingestion-callback → publishLiveScoreUpdate
      // would take in production.
      await publishLiveScoreUpdate(
        {
          category: 'GOLF',
          externalEventId: fixture.externalEventId,
          rounds: [
            { participantExternalId: fixture.externalGolferIds.rory, round: 1, strokes: 69, scoreToPar: -3, status: 'COMPLETED' },
            { participantExternalId: fixture.externalGolferIds.tiger, round: 1, strokes: 71, scoreToPar: -1, status: 'COMPLETED' },
            { participantExternalId: fixture.externalGolferIds.jordan, round: 1, strokes: 74, scoreToPar: 2, status: 'COMPLETED' },
            { participantExternalId: fixture.externalGolferIds.scottie, round: 1, strokes: 72, scoreToPar: 0, status: 'COMPLETED' },
          ],
        },
        { prisma, providerId: PROVIDER_ID, bus: eventBus },
      );

      // Wait for the consumer's async transaction + rollup handoff to settle.
      // The consumer subscribes synchronously to live_score.persisted, but
      // its handler is async and spawns its own DB transaction; without a
      // wait the assertions below race the writes.
      await waitFor(async () => {
        const contributions = await prisma.contestEntryPickGolfRosterContribution.count({
          where: { pick: { entry: { contestId: fixture.contestId } } },
        });
        return contributions === 4;
      }, 5_000);

      // 1. Per-round detail rows landed (4 — one per golfer).
      const golfRounds = await prisma.sportEventParticipantGolfRound.findMany({
        where: { sportEventParticipant: { sportEventId: fixture.sportEventId } },
        orderBy: { strokes: 'asc' },
      });
      expect(golfRounds).toHaveLength(4);
      expect(golfRounds.map((r) => r.scoreToPar)).toEqual([-3, -1, 0, 2]);

      // 2. live_score.persisted fired with the resolved internal sportEventId.
      expect(persistedEvents).toHaveLength(1);
      expect(persistedEvents[0]).toEqual(
        expect.objectContaining({
          type: 'live_score.persisted',
          category: 'GOLF',
          providerId: PROVIDER_ID,
          sportEventId: fixture.sportEventId,
          updatesPersisted: 4,
        }),
      );

      // 3. Contribution rows written for every pick (4 = 2 entries × 2 picks).
      const contributions = await prisma.contestEntryPickGolfRosterContribution.findMany({
        where: { pick: { entry: { contestId: fixture.contestId } } },
        orderBy: [{ contestEntryPickId: 'asc' }, { round: 'asc' }],
      });
      expect(contributions).toHaveLength(4);
      // Each contribution = scoreToPar (golf-roster invariant).
      for (const c of contributions) {
        expect(Number(c.contribution)).toBe(c.scoreToPar);
      }

      // 4. ContestEntry.totalScore = SUM(contribution) per affected entry.
      const entries = await prisma.contestEntry.findMany({
        where: { contestId: fixture.contestId },
        orderBy: { entryNumber: 'asc' },
      });
      expect(entries).toHaveLength(2);
      const entryA = entries.find((e) => e.id === fixture.entryAId)!;
      const entryB = entries.find((e) => e.id === fixture.entryBId)!;
      expect(entryA.totalScore).toBe(-4); // -3 + -1
      expect(entryB.totalScore).toBe(2);  //  2 +  0

      // 5. Standings reranked with LOWER_IS_BETTER (golf-roster wins low).
      expect(entryA.standingsPosition).toBe(1);
      expect(entryB.standingsPosition).toBe(2);

      // 6. standings.updated fired with the reranked leaderboard.
      expect(standingsEvents).toHaveLength(1);
      const standings = standingsEvents[0].standings;
      expect(standings[0]).toEqual(expect.objectContaining({ entryId: fixture.entryAId, rank: 1, totalScore: -4 }));
      expect(standings[1]).toEqual(expect.objectContaining({ entryId: fixture.entryBId, rank: 2, totalScore: 2 }));

      // 7. HTTP GET /api/v1/contests/:contestId/standings reflects the rerank.
      // Auth via createTestUser's session — leverage one of the league users.
      const { headers } = await createTestUser({ displayName: 'Live-scoring Reader' });
      const standingsRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/contests/${fixture.contestId}/standings`,
        headers,
      });
      expect(standingsRes.statusCode).toBe(200);
      const body = standingsRes.json() as { standings?: Array<{ entryId: string; rank: number; totalScore: number }> };
      expect(body.standings).toBeDefined();
      const httpStandings = body.standings ?? [];
      const httpA = httpStandings.find((s) => s.entryId === fixture.entryAId);
      const httpB = httpStandings.find((s) => s.entryId === fixture.entryBId);
      expect(httpA?.rank).toBe(1);
      expect(httpA?.totalScore).toBe(-4);
      expect(httpB?.rank).toBe(2);
      expect(httpB?.totalScore).toBe(2);
    } finally {
      consumer.unsubscribe();
      eventBus.clear();
    }
  });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`);
}
