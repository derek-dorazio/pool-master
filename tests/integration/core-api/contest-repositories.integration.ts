import { randomUUID } from 'node:crypto';
import { ContestStatus, Sport } from '@poolmaster/shared/domain';
import {
  PrismaContestEntryPickRepository,
  PrismaContestEntryRepository,
  PrismaContestEntryStandingRepository,
  PrismaContestRepository,
} from '../../../packages/core-api/src/adapters';
import { createEventLifecycleService } from '../../../packages/core-api/src/modules/events/wiring';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';
import { mockFn } from '../../support/mock-fn';
import type { MailDeliveryProvider } from '../../../packages/core-api/src/modules/email/mail-delivery';

// The contest-cluster ports (#247) against real Postgres: what each read returns and in what
// order, what each write leaves behind, and that deleting a contest takes everything under it.
// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(async () => {
  await cleanupTestData();
});

function repos() {
  const prisma = getPrisma();
  return {
    contests: new PrismaContestRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    picks: new PrismaContestEntryPickRepository(prisma),
    standings: new PrismaContestEntryStandingRepository(prisma),
  };
}

/** A league with two squads, and a golf event with three golfers on its field. */
async function createLeagueAndEvent() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const owner = await createTestUser({ displayName: `Contest Repo ${suffix}` });
  const league = await prisma.league.create({
    data: { leagueCode: `CREPO${suffix.toUpperCase()}`, name: `Contest Repo League ${suffix}` },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const [alpha, bravo] = await Promise.all([
    prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Alpha ${suffix}` } }),
    prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Bravo ${suffix}` } }),
  ]);
  const sport = await prisma.sport.upsert({
    where: { name: Sport.GOLF },
    create: { name: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `contest-repo-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Contest Repo Open ${suffix}`,
      startDate: new Date('2026-06-04T12:00:00.000Z'),
      endDate: new Date('2026-06-07T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const field = [];
  for (const [name, role] of [['Golfer One', 'GOLFER'], ['Golfer Two', null], ['Golfer Three', null]] as const) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `${name} ${suffix}`, participantType: 'INDIVIDUAL', status: 'ACTIVE', role },
    });
    field.push(await prisma.sportEventParticipant.create({
      data: { sportEventId: event.id, participantId: participant.id, isActive: true },
    }));
  }
  return { owner, league, squads: [alpha, bravo] as const, event, field, suffix };
}

async function createContest(leagueId: string, sportEventId: string, name: string, status: ContestStatus = ContestStatus.ACTIVE) {
  return repos().contests.create({
    leagueId,
    sportEventId,
    name,
    status,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    scoringEngine: 'STROKE_PLAY',
  });
}

describe('ContestRepository', () => {
  it('creates a contest and reads it back with its event\'s sport', async () => {
    const { league, event } = await createLeagueAndEvent();

    const created = await createContest(league.id, event.id, 'Created Contest', ContestStatus.DRAFT);

    expect(created).toEqual(expect.objectContaining({
      leagueId: league.id,
      sportEventId: event.id,
      name: 'Created Contest',
      status: ContestStatus.DRAFT,
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      scoringEngine: 'STROKE_PLAY',
      sport: Sport.GOLF,
    }));
    await expect(repos().contests.findById(created.id)).resolves.toEqual(created);
  });

  it('finds an event\'s contests oldest first, leaving out the excluded statuses', async () => {
    const { league, event } = await createLeagueAndEvent();
    const active = await createContest(league.id, event.id, 'Active');
    const completed = await createContest(league.id, event.id, 'Completed', ContestStatus.COMPLETED);
    const cancelled = await createContest(league.id, event.id, 'Cancelled', ContestStatus.CANCELLED);
    const open = await createContest(league.id, event.id, 'Open', ContestStatus.OPEN);

    const all = await repos().contests.findBySportEvent(event.id);
    const unsettled = await repos().contests.findBySportEvent(event.id, {
      excludeStatuses: [ContestStatus.CANCELLED, ContestStatus.COMPLETED],
    });

    expect(all.map((contest) => contest.id)).toEqual([active.id, completed.id, cancelled.id, open.id]);
    expect(unsettled.map((contest) => contest.id)).toEqual([active.id, open.id]);
  });

  it('narrows an event\'s contests to some statuses', async () => {
    const { league, event } = await createLeagueAndEvent();
    await createContest(league.id, event.id, 'Draft', ContestStatus.DRAFT);
    const open = await createContest(league.id, event.id, 'Open', ContestStatus.OPEN);
    const locked = await createContest(league.id, event.id, 'Locked', ContestStatus.LOCKED);

    const pending = await repos().contests.findBySportEvent(event.id, {
      statuses: [ContestStatus.OPEN, ContestStatus.LOCKED],
    });

    expect(pending.map((contest) => contest.id)).toEqual([open.id, locked.id]);
  });

  it('transitions a contest only from the given statuses: the second run changes nothing and says so', async () => {
    const { league, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'To Start', ContestStatus.OPEN);
    const startsAt = new Date('2026-06-04T12:00:00.000Z');
    const start = { from: [ContestStatus.OPEN, ContestStatus.LOCKED], to: ContestStatus.ACTIVE, startsAt };

    await expect(repos().contests.transitionStatus(contest.id, start)).resolves.toBe(true);
    await expect(repos().contests.transitionStatus(contest.id, start)).resolves.toBe(false);
    const started = await repos().contests.findById(contest.id);
    expect(started).toEqual(expect.objectContaining({ status: ContestStatus.ACTIVE, startsAt, endsAt: undefined }));

    const endsAt = new Date('2026-06-07T22:00:00.000Z');
    await expect(repos().contests.transitionStatus(contest.id, {
      from: [ContestStatus.ACTIVE], to: ContestStatus.COMPLETED, endsAt,
    })).resolves.toBe(true);
    const completed = await repos().contests.findById(contest.id);
    expect(completed).toEqual(expect.objectContaining({ status: ContestStatus.COMPLETED, startsAt, endsAt }));
  });

  it('deletes a DRAFT contest whose configuration carries a scoring rule and a prize definition, with everything under it', async () => {
    // Before #247 the delete left the configuration's rules and prizes in place, so the
    // configuration's own delete failed on their foreign keys. #246's backfill gave every golf
    // configuration a rule, which made that every DRAFT golf contest.
    const prisma = getPrisma();
    const { league, squads, event, field } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Draft With Rules', ContestStatus.DRAFT);
    const configuration = await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: 'TIERED',
        rosterSize: 1,
        participantScoringRules: {
          create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 },
        },
        prizeDefinitions: {
          create: { prizeDefinitionId: 'WINNER', displayName: 'Winner', sortOrder: 1 },
        },
      },
    });
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Entry' },
    });
    await prisma.contestEntryPick.create({
      data: { entryId: entry.id, sportEventParticipantId: field[0].id, contestFormat: 'ROSTER', slot: 1 },
    });
    await repos().standings.upsert({
      contestId: contest.id,
      contestEntryId: entry.id,
      position: 1,
      displayPosition: '1',
      countingPickLimit: 1,
      scoredPickCount: 1,
      asOf: null,
      settledAt: new Date(),
      golf: { totalScoreToPar: -3 },
    });

    await repos().contests.delete(contest.id);

    await expect(repos().contests.findById(contest.id)).resolves.toBeNull();
    const remaining = await Promise.all([
      prisma.contestConfiguration.count({ where: { id: configuration.id } }),
      prisma.participantContestScoringRule.count({ where: { contestConfigurationId: configuration.id } }),
      prisma.contestPrizeDefinition.count({ where: { contestConfigurationId: configuration.id } }),
      prisma.contestEntry.count({ where: { contestId: contest.id } }),
      prisma.contestEntryPick.count({ where: { entryId: entry.id } }),
      prisma.contestEntryStanding.count({ where: { contestId: contest.id } }),
      prisma.contestEntryGolfStanding.count({ where: { contestEntryStanding: { contestEntryId: entry.id } } }),
    ]);
    expect(remaining).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('ContestEntryRepository — entries with their squad', () => {
  it('lists a contest\'s entries by entry number with squad names, optionally only the active ones', async () => {
    const prisma = getPrisma();
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Entries');
    // Inserted out of order, so the order below is the adapter's, not insertion order.
    const second = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squads[1].id, entryNumber: 2, name: 'Second' },
    });
    const first = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'First' },
    });
    const withdrawn = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 3, name: 'Withdrawn', status: 'WITHDRAWN' },
    });

    const all = await repos().entries.findByContestWithSquad(contest.id);
    const active = await repos().entries.findByContestWithSquad(contest.id, { activeOnly: true });
    const one = await repos().entries.findByIdWithSquad(second.id);

    expect(all.map((entry) => [entry.id, entry.squadName])).toEqual([
      [first.id, `Alpha ${suffix}`],
      [second.id, `Bravo ${suffix}`],
      [withdrawn.id, `Alpha ${suffix}`],
    ]);
    expect(active.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(one).toEqual(expect.objectContaining({ id: second.id, entryNumber: 2, squadName: `Bravo ${suffix}` }));
    await expect(repos().entries.findByIdWithSquad(randomUUID())).resolves.toBeNull();
  });
});

describe('ContestEntryPickRepository — read-only', () => {
  it('reads picks in pick order, with their golfer, and counts them per entry', async () => {
    const prisma = getPrisma();
    const { league, squads, event, field, suffix } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Picks');
    const [picked, empty] = await Promise.all([
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Picked' } }),
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[1].id, entryNumber: 1, name: 'Empty' } }),
    ]);
    await prisma.sportEventParticipant.update({
      where: { id: field[1].id },
      data: { isActive: false, inactiveReason: 'WITHDRAWN' },
    });
    const later = await prisma.contestEntryPick.create({
      data: {
        entryId: picked.id, sportEventParticipantId: field[1].id, contestFormat: 'ROSTER', slot: 2,
        pickedAt: new Date('2026-06-01T12:05:00.000Z'),
      },
    });
    const earlier = await prisma.contestEntryPick.create({
      data: {
        entryId: picked.id, sportEventParticipantId: field[0].id, contestFormat: 'ROSTER', slot: 1,
        pickedAt: new Date('2026-06-01T12:00:00.000Z'),
      },
    });

    const picks = await repos().picks.findByEntries([picked.id, empty.id]);
    const withParticipant = await repos().picks.findByEntriesWithParticipant([picked.id]);
    const counts = await repos().picks.countByEntries([picked.id, empty.id]);

    expect(picks.map((pick) => [pick.id, pick.slot, pick.contestFormat])).toEqual([
      [earlier.id, 1, 'ROSTER'],
      [later.id, 2, 'ROSTER'],
    ]);
    expect(withParticipant.map((pick) => pick.participant)).toEqual([
      {
        participantId: field[0].participantId,
        participantName: `Golfer One ${suffix}`,
        isActive: true,
        inactiveReason: null,
        role: 'GOLFER',
        teamAffiliation: null,
      },
      {
        participantId: field[1].participantId,
        participantName: `Golfer Two ${suffix}`,
        isActive: false,
        inactiveReason: 'WITHDRAWN',
        role: null,
        teamAffiliation: null,
      },
    ]);
    // An entry with no picks is absent from the map, not zero.
    expect(counts).toEqual(new Map([[picked.id, 2]]));
    await expect(repos().picks.findByEntries([])).resolves.toEqual([]);
    await expect(repos().picks.countByEntries([])).resolves.toEqual(new Map());
  });

  it('has no insert: ContestEntryPickService.createPick stays the single insert path (plans/117 §7.1)', () => {
    const port = repos().picks as unknown as Record<string, unknown>;
    for (const write of ['create', 'createMany', 'upsert', 'update', 'delete']) {
      expect(port[write]).toBeUndefined();
    }
  });
});

describe('ContestEntryStandingRepository', () => {
  it('writes the core row and its golf extension together, overwrites both on the next upsert, and reads unranked entries last', async () => {
    const prisma = getPrisma();
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Standings');
    const [ranked, unranked] = await Promise.all([
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Ranked' } }),
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[1].id, entryNumber: 1, name: 'Unranked' } }),
    ]);
    const settledAt = new Date('2026-06-07T22:00:00.000Z');
    const base = {
      contestId: contest.id,
      countingPickLimit: 2,
      asOf: new Date('2026-06-07T21:00:00.000Z'),
      settledAt,
    };
    await repos().standings.upsert({
      ...base, contestEntryId: unranked.id, position: null, displayPosition: null, scoredPickCount: 0,
      golf: { totalScoreToPar: null },
    });
    await repos().standings.upsert({
      ...base, contestEntryId: ranked.id, position: 2, displayPosition: '2', scoredPickCount: 2,
      golf: { totalScoreToPar: -1 },
    });
    // A re-settle overwrites the entry's row rather than adding a second one.
    await repos().standings.upsert({
      ...base, contestEntryId: ranked.id, position: 1, displayPosition: '1', scoredPickCount: 2,
      golf: { totalScoreToPar: -4 },
    });

    const standings = await repos().standings.findByContest(contest.id);

    expect(standings.map((standing) => [standing.contestEntryId, standing.position, standing.displayPosition, standing.golf]))
      .toEqual([
        [ranked.id, 1, '1', { totalScoreToPar: -4 }],
        [unranked.id, null, null, { totalScoreToPar: null }],
      ]);
    expect(standings[0]).toEqual(expect.objectContaining({ countingPickLimit: 2, scoredPickCount: 2, settledAt }));
    await expect(prisma.contestEntryStanding.count({ where: { contestId: contest.id } })).resolves.toBe(2);
    await expect(prisma.contestEntryGolfStanding.count({
      where: { contestEntryStanding: { contestId: contest.id } },
    })).resolves.toBe(2);
  });

  it('writes a standing without a golf extension when there is none', async () => {
    const prisma = getPrisma();
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Core Only');
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Core' },
    });

    await repos().standings.upsert({
      contestId: contest.id, contestEntryId: entry.id, position: 1, displayPosition: '1',
      countingPickLimit: 1, scoredPickCount: 1, asOf: null, settledAt: new Date(), golf: null,
    });

    const [standing] = await repos().standings.findByContest(contest.id);
    expect(standing.golf).toBeNull();
  });
});

describe('EventLifecycleService — starting an event\'s contests on the ports (#247)', () => {
  it('activates the event\'s OPEN contest once and tells its commissioner and entrants, active users only', async () => {
    const prisma = getPrisma();
    const { owner, league, squads, event } = await createLeagueAndEvent();
    const open = await createContest(league.id, event.id, 'Starts With The Event', ContestStatus.OPEN);
    const draft = await createContest(league.id, event.id, 'Never Opened', ContestStatus.DRAFT);
    const [member, lapsed] = await Promise.all([
      createTestUser({ displayName: 'Squad Member' }),
      createTestUser({ displayName: 'Lapsed Member' }),
    ]);
    await prisma.user.update({ where: { id: lapsed.user.id }, data: { isActive: false } });
    for (const user of [member, lapsed]) {
      await prisma.leagueMembership.create({
        data: { leagueId: league.id, userId: user.user.id, role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date() },
      });
      await prisma.squadMembership.create({
        data: { squadId: squads[0].id, leagueId: league.id, userId: user.user.id, status: 'ACTIVE', joinedAt: new Date() },
      });
    }
    await prisma.contestEntry.create({
      data: { contestId: open.id, squadId: squads[0].id, entryNumber: 1, name: 'Alpha Entry' },
    });
    const send = mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail' }));
    const lifecycle = createEventLifecycleService(prisma, {
      mailDelivery: { providerName: 'smtp', send },
      appBaseUrl: 'https://app.example.test',
    });

    await lifecycle.applySportEventStatusTransition({
      sportEventId: event.id, toStatus: 'IN_PROGRESS', actor: { type: 'ROOT_ADMIN' },
    });

    const [started, untouched] = await Promise.all([
      repos().contests.findById(open.id),
      repos().contests.findById(draft.id),
    ]);
    expect(started).toEqual(expect.objectContaining({ status: ContestStatus.ACTIVE, startsAt: event.startDate }));
    expect(untouched?.status).toBe(ContestStatus.DRAFT);
    expect(send.mock.calls.map(([message]) => String(message.to)).sort()).toEqual([owner.user.email, member.user.email].sort());
    expect(send.mock.calls[0][0].text).toContain('- Alpha Entry: Alpha');

    // The provider re-sending IN_PROGRESS finds nothing left to start, so nobody is told twice.
    await lifecycle.applySportEventStatusTransition({
      sportEventId: event.id, toStatus: 'IN_PROGRESS', actor: { type: 'SYSTEM' },
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
