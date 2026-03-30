/**
 * Integration: Prisma adapter repositories — direct repository method testing
 * for low-coverage adapters (DraftSession, ContestEntry, ContestStanding,
 * ActionItem, ParticipantProviderMapping, ParticipantSeasonRecord).
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
  getApp,
  createTestUser,
  cleanupTestData,
} from '../helpers';

import { PrismaDraftSessionRepository } from '../../../packages/core-api/src/adapters/prisma-draft-session-repository';
import { PrismaContestEntryRepository } from '../../../packages/core-api/src/adapters/prisma-contest-entry-repository';
import { PrismaContestStandingRepository } from '../../../packages/core-api/src/adapters/prisma-contest-standing-repository';
import { PrismaActionItemRepository } from '../../../packages/core-api/src/adapters/prisma-action-item-repository';
import { PrismaParticipantProviderMappingRepository } from '../../../packages/core-api/src/adapters/prisma-participant-provider-mapping-repository';
import { PrismaParticipantSeasonRecordRepository } from '../../../packages/core-api/src/adapters/prisma-participant-season-record-repository';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

// ---------------------------------------------------------------------------
// Shared fixture state
// ---------------------------------------------------------------------------

let leagueId: string;
let contestId: string;
let leagueMembershipId: string;
let participantId: string;
let sportId: string;
let ownerHeaders: Record<string, string>;

beforeAll(async () => {
  const prisma = getPrisma();

  // Create test user + league via API (creates OWNER membership automatically)
  const owner = await createTestUser({ displayName: 'Adapter Test Owner' });
  ownerHeaders = owner.headers;

  const leagueRes = await getApp().inject({
    method: 'POST',
    url: '/api/v1/leagues',
    headers: owner.headers,
    payload: { name: 'Adapter Test League', visibility: 'PRIVATE' },
  });
  leagueId = leagueRes.json().league.id;

  // Get the auto-created OWNER membership
  const membership = await prisma.leagueMembership.findFirst({
    where: { leagueId, userId: owner.user.id },
  });
  leagueMembershipId = membership!.id;

  // Create a contest
  const contestRes = await getApp().inject({
    method: 'POST',
    url: `/api/v1/leagues/${leagueId}/contests`,
    headers: owner.headers,
    payload: {
      name: 'Adapter Test Contest',
      contestType: 'SINGLE_EVENT',
      selectionType: 'SNAKE_DRAFT',
      scoringEngine: 'STROKE_PLAY',
    },
  });
  const contestBody = contestRes.json();
  contestId = (contestBody.contest ?? contestBody).id;

  // Create a Sport + Participant for draft pick / provider mapping tests
  const sport = await prisma.sport.upsert({
    where: { name: 'GOLF' },
    create: { name: 'GOLF', participantType: 'INDIVIDUAL' },
    update: {},
  });
  sportId = sport.id;

  const participant = await prisma.participant.create({
    data: {
      sportId,
      name: 'Tiger Woods',
      participantType: 'INDIVIDUAL',
    },
  });
  participantId = participant.id;
});

// ---------------------------------------------------------------------------
// DraftSessionRepository
// ---------------------------------------------------------------------------

describe('PrismaDraftSessionRepository', () => {
  let repo: PrismaDraftSessionRepository;
  let sessionId: string;
  let entryId: string;

  beforeAll(() => {
    repo = new PrismaDraftSessionRepository(getPrisma());
  });

  it('creates a draft session', async () => {
    const session = await repo.create({
      contestId,
      status: 'PENDING',
      currentPickNumber: 0,
      currentEntryId: undefined,
      startedAt: undefined,
      pickDeadline: undefined,
    });

    expect(session.id).toBeDefined();
    expect(session.contestId).toBe(contestId);
    expect(session.status).toBe('PENDING');
    expect(session.currentPickNumber).toBe(0);
    sessionId = session.id;
  });

  it('findByContest returns the session', async () => {
    const session = await repo.findByContest(contestId);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(sessionId);
    expect(session!.contestId).toBe(contestId);
  });

  it('updates a session', async () => {
    const updated = await repo.update(sessionId, { status: 'PAUSED' });
    expect(updated.status).toBe('PAUSED');
    expect(updated.id).toBe(sessionId);
  });

  it('addPick + getPicks round-trips a draft pick', async () => {
    // Create a contest entry for the pick
    const entryRepo = new PrismaContestEntryRepository(getPrisma());
    const entry = await entryRepo.create({
      contestId,
      leagueMembershipId,
      name: 'Draft Pick Test Entry',
      totalScore: 0,
      rank: undefined,
      isEliminated: false,
    });
    entryId = entry.id;

    const pick = await repo.addPick({
      draftSessionId: sessionId,
      entryId,
      participantId,
      pickNumber: 1,
      round: 1,
      pickInRound: 1,
      pickedAt: new Date(),
      autoPicked: false,
    });

    expect(pick.id).toBeDefined();
    expect(pick.draftSessionId).toBe(sessionId);
    expect(pick.participantId).toBe(participantId);
    expect(pick.pickNumber).toBe(1);
    expect(pick.autoPicked).toBe(false);

    const picks = await repo.getPicks(sessionId);
    expect(picks).toHaveLength(1);
    expect(picks[0].participantId).toBe(participantId);
  });
});

// ---------------------------------------------------------------------------
// ContestEntryRepository
// ---------------------------------------------------------------------------

describe('PrismaContestEntryRepository', () => {
  let repo: PrismaContestEntryRepository;
  let entryId: string;
  let entryContestId: string;

  beforeAll(async () => {
    repo = new PrismaContestEntryRepository(getPrisma());
    // Create a dedicated contest to avoid unique constraint conflicts
    const cr = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/contests`,
      headers: ownerHeaders,
      payload: { name: 'Entry Test Contest', contestType: 'SINGLE_EVENT', selectionType: 'SNAKE_DRAFT', scoringEngine: 'STROKE_PLAY' },
    });
    entryContestId = cr.json().contest.id;
  });

  it('creates an entry', async () => {
    const entry = await repo.create({
      contestId: entryContestId,
      leagueMembershipId,
      name: 'Test Entry Alpha',
      totalScore: 0,
      rank: undefined,
      isEliminated: false,
    });

    expect(entry.id).toBeDefined();
    expect(entry.contestId).toBe(entryContestId);
    expect(entry.name).toBe('Test Entry Alpha');
    expect(entry.totalScore).toBe(0);
    entryId = entry.id;
  });

  it('findByContest returns entries', async () => {
    const entries = await repo.findByContest(entryContestId);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const found = entries.find((e) => e.id === entryId);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test Entry Alpha');
  });

  it('findByMember returns entries for the membership', async () => {
    const entries = await repo.findByMember(leagueMembershipId);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.id === entryId)).toBe(true);
  });

  it('updates an entry totalScore', async () => {
    const updated = await repo.update(entryId, { totalScore: 50 });
    expect(updated.totalScore).toBe(50);
    expect(updated.id).toBe(entryId);
  });
});

// ---------------------------------------------------------------------------
// ContestStandingRepository
// ---------------------------------------------------------------------------

describe('PrismaContestStandingRepository', () => {
  let repo: PrismaContestStandingRepository;
  let standingEntryId: string;

  beforeAll(async () => {
    repo = new PrismaContestStandingRepository(getPrisma());

    // Create a dedicated entry for the standing (unique constraint: contestId + entryId)
    const entryRepo = new PrismaContestEntryRepository(getPrisma());

    // Use a second user to avoid the unique contestId+leagueMembershipId constraint
    const user2 = await createTestUser({ displayName: 'Standing User' });
    const joinRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/members`,
      headers: user2.headers,
      payload: {},
    });
    // Try to get membership; if join endpoint doesn't exist, create via Prisma
    let membershipId2: string;
    if (joinRes.statusCode < 300) {
      const body = joinRes.json();
      membershipId2 = (body.membership ?? body).id;
    } else {
      const m = await getPrisma().leagueMembership.create({
        data: {
          leagueId,
          userId: user2.user.id,
          role: 'MEMBER',
        },
      });
      membershipId2 = m.id;
    }

    const entry = await entryRepo.create({
      contestId,
      leagueMembershipId: membershipId2,
      name: 'Standing Test Entry',
      totalScore: 0,
      rank: undefined,
      isEliminated: false,
    });
    standingEntryId = entry.id;
  });

  it('upserts a standing and findByContest returns it', async () => {
    const now = new Date();
    const standing = await repo.upsert({
      contestId,
      entryId: standingEntryId,
      rank: 1,
      totalScore: 100,
      lastUpdatedAt: now,
    });

    expect(standing.id).toBeDefined();
    expect(standing.contestId).toBe(contestId);
    expect(standing.entryId).toBe(standingEntryId);
    expect(standing.rank).toBe(1);
    expect(standing.totalScore).toBe(100);

    // Upsert again with updated score
    const updated = await repo.upsert({
      contestId,
      entryId: standingEntryId,
      rank: 2,
      totalScore: 200,
      lastUpdatedAt: now,
    });
    expect(updated.id).toBe(standing.id); // same row
    expect(updated.rank).toBe(2);
    expect(updated.totalScore).toBe(200);

    const standings = await repo.findByContest(contestId);
    expect(standings.length).toBeGreaterThanOrEqual(1);
    expect(standings.some((s) => s.entryId === standingEntryId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ActionItemRepository
// ---------------------------------------------------------------------------

describe('PrismaActionItemRepository', () => {
  let repo: PrismaActionItemRepository;
  let itemId: string;

  beforeAll(() => {
    repo = new PrismaActionItemRepository(getPrisma());
  });

  it('creates an action item and findByLeague returns it', async () => {
    const item = await repo.create({
      leagueId,
      contestId,
      type: 'SCORE_OVERRIDE_NEEDED',
      priority: 'HIGH',
      title: 'Review scoring for round 3',
      description: 'Scores need manual verification',
      actionUrl: undefined,
      resolved: false,
      resolvedAt: undefined,
    });

    expect(item.id).toBeDefined();
    expect(item.leagueId).toBe(leagueId);
    expect(item.type).toBe('SCORE_OVERRIDE_NEEDED');
    expect(item.priority).toBe('HIGH');
    expect(item.resolved).toBe(false);
    itemId = item.id;

    const items = await repo.findByLeague(leagueId);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((i) => i.id === itemId)).toBe(true);
  });

  it('resolves an action item', async () => {
    const resolved = await repo.resolve(itemId);
    expect(resolved.resolved).toBe(true);
    expect(resolved.resolvedAt).toBeDefined();

    // findByLeague without includeResolved should NOT return it
    const unresolved = await repo.findByLeague(leagueId, false);
    expect(unresolved.some((i) => i.id === itemId)).toBe(false);

    // findByLeague with includeResolved should return it
    const all = await repo.findByLeague(leagueId, true);
    expect(all.some((i) => i.id === itemId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ParticipantProviderMappingRepository
// ---------------------------------------------------------------------------

describe('PrismaParticipantProviderMappingRepository', () => {
  let repo: PrismaParticipantProviderMappingRepository;

  beforeAll(() => {
    repo = new PrismaParticipantProviderMappingRepository(getPrisma());
  });

  it('creates a mapping and findByParticipant returns it', async () => {
    const mapping = await repo.create({
      participantId,
      providerId: 'espn',
      externalId: `espn-tiger-${Date.now()}`,
      confidence: 'EXACT',
      mappedAt: new Date(),
    });

    expect(mapping.id).toBeDefined();
    expect(mapping.participantId).toBe(participantId);
    expect(mapping.providerId).toBe('espn');
    expect(mapping.externalId).toBeDefined();
    expect(mapping.confidence).toBe('EXACT');

    const mappings = await repo.findByParticipant(participantId);
    expect(mappings.length).toBeGreaterThanOrEqual(1);
    expect(mappings.some((m) => m.providerId === 'espn')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ParticipantSeasonRecordRepository
// ---------------------------------------------------------------------------

describe('PrismaParticipantSeasonRecordRepository', () => {
  let repo: PrismaParticipantSeasonRecordRepository;

  beforeAll(() => {
    repo = new PrismaParticipantSeasonRecordRepository(getPrisma());
  });

  it('upserts a season record and findBySportAndSeason returns it', async () => {
    const now = new Date();
    const record = await repo.upsert({
      participantId,
      sport: 'GOLF',
      season: '2025-2026',
      rankings: [],
      budgetPrice: 8500,
      priceTier: 'ELITE',
      priceUpdatedAt: now,
      eventsEntered: 12,
      eventsCompleted: 10,
      wins: 2,
      top5Finishes: 5,
      top10Finishes: 7,
      top25Finishes: 9,
      seasonStats: { avgScore: 69.5 },
      formRating: 85.5,
      formTrend: 'RISING',
      lastUpdated: now,
    });

    expect(record.id).toBeDefined();
    expect(record.participantId).toBe(participantId);
    expect(record.sport).toBe('GOLF');
    expect(record.season).toBe('2025-2026');
    expect(record.budgetPrice).toBe(8500);
    expect(record.wins).toBe(2);
    expect(record.formRating).toBeCloseTo(85.5);
    expect(record.formTrend).toBe('RISING');

    // Upsert again with updated stats
    const updated = await repo.upsert({
      participantId,
      sport: 'GOLF',
      season: '2025-2026',
      rankings: [{ rankingType: 'OWGR', rank: 3, asOfDate: now }],
      budgetPrice: 9000,
      priceTier: 'ELITE',
      priceUpdatedAt: now,
      eventsEntered: 14,
      eventsCompleted: 12,
      wins: 3,
      top5Finishes: 6,
      top10Finishes: 8,
      top25Finishes: 10,
      seasonStats: { avgScore: 68.8 },
      formRating: 90.0,
      formTrend: 'RISING',
      lastUpdated: now,
    });

    expect(updated.id).toBe(record.id); // same row
    expect(updated.wins).toBe(3);
    expect(updated.budgetPrice).toBe(9000);

    const records = await repo.findBySportAndSeason('GOLF', '2025-2026');
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records.some((r) => r.participantId === participantId)).toBe(true);
  });
});
