import { DashboardService } from '../../../packages/core-api/src/modules/leagues/dashboard-service';
import type {
  ActionItemRepository,
  ContestRepository,
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import { ContestStatus, InvitationStatus } from '@poolmaster/shared/domain';
import { buildContest, buildInvitation, buildLeague, buildMembership } from '../../factories';

function createMockLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return {
    findById: jest.fn().mockResolvedValue(buildLeague({ id: 'league-1' })),
    findByCode: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(buildLeague()),
    update: jest.fn().mockResolvedValue(buildLeague()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn().mockResolvedValue([
      buildMembership({ userId: 'user-1' }),
      buildMembership({ userId: 'user-2' }),
    ]),
    findByUser: jest.fn().mockResolvedValue([]),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(buildMembership()),
    update: jest.fn().mockResolvedValue(buildMembership()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByLeague: jest.fn().mockResolvedValue([
      buildContest({ name: 'Active Pool', status: ContestStatus.ACTIVE }),
      buildContest({
        name: 'Future Pool',
        status: ContestStatus.DRAFT,
        startsAt: new Date('2099-06-01'),
        lockAt: new Date('2099-05-31'),
      }),
    ]),
    create: jest.fn().mockResolvedValue(buildContest()),
    update: jest.fn().mockResolvedValue(buildContest()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockInvitationRepo(
  overrides: Partial<LeagueInvitationRepository> = {},
): LeagueInvitationRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByLeague: jest.fn().mockResolvedValue([
      buildInvitation({ status: InvitationStatus.PENDING }),
      buildInvitation({ status: InvitationStatus.PENDING }),
      buildInvitation({ status: InvitationStatus.ACCEPTED }),
    ]),
    findByCode: jest.fn().mockResolvedValue(null),
    findByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(buildInvitation()),
    update: jest.fn().mockResolvedValue(buildInvitation()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockActionItemRepo(
  overrides: Partial<ActionItemRepository> = {},
): ActionItemRepository {
  return {
    findByLeague: jest.fn().mockResolvedValue([]),
    findUnresolved: jest.fn().mockResolvedValue([
      {
        id: 'ai-1',
        leagueId: 'league-1',
        type: 'JOIN_REQUEST',
        priority: 'HIGH',
        title: 'New join request',
        resolved: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-ai-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    resolve: jest.fn().mockImplementation(async (id) => ({
      id,
      leagueId: 'league-1',
      type: 'JOIN_REQUEST',
      priority: 'HIGH',
      title: 'Resolved',
      resolved: true,
      resolvedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('DashboardService', () => {
  describe('getDashboard', () => {
    it('returns full dashboard with all widgets', async () => {
      const service = new DashboardService(
        createMockLeagueRepo(),
        createMockMembershipRepo(),
        createMockContestRepo(),
        createMockInvitationRepo(),
        createMockActionItemRepo(),
      );
      const dashboard = await service.getDashboard('league-1');
      expect(dashboard).not.toBeNull();
      expect(dashboard!.league.id).toBe('league-1');
      expect(dashboard!.memberCount).toBe(2);
      expect(dashboard!.pendingInvites).toBe(2);
      expect(dashboard!.contests).toHaveLength(2);
      expect(dashboard!.actionItems).toHaveLength(1);
      expect(dashboard!.recentMemberActivity.length).toBeGreaterThan(0);
    });

    it('sorts recent member activity without mutating repository results', async () => {
      const members = [
        buildMembership({ userId: 'user-older', joinedAt: new Date('2026-01-02') }),
        buildMembership({ userId: 'user-middle', joinedAt: new Date('2026-01-05') }),
        buildMembership({ userId: 'user-newer', joinedAt: new Date('2026-01-09') }),
      ];

      const service = new DashboardService(
        createMockLeagueRepo(),
        createMockMembershipRepo({
          findByLeague: jest.fn().mockResolvedValue(members),
        }),
        createMockContestRepo(),
        createMockInvitationRepo(),
        createMockActionItemRepo(),
      );

      const dashboard = await service.getDashboard('league-1');

      expect(dashboard!.recentMemberActivity.map((activity) => activity.userId)).toEqual([
        'user-newer',
        'user-middle',
        'user-older',
      ]);
      expect(members.map((member) => member.userId)).toEqual([
        'user-older',
        'user-middle',
        'user-newer',
      ]);
    });

    it('limits upcoming events to the most recent twenty and keeps them in chronological order', async () => {
      const contests = Array.from({ length: 21 }, (_, index) =>
        buildContest({
          id: `contest-${index + 1}`,
          name: `Contest ${index + 1}`,
          startsAt: new Date(Date.now() + (index + 1) * 24 * 60 * 60_000),
        }),
      );

      const service = new DashboardService(
        createMockLeagueRepo(),
        createMockMembershipRepo(),
        createMockContestRepo({
          findByLeague: jest.fn().mockResolvedValue(contests),
        }),
        createMockInvitationRepo(),
        createMockActionItemRepo(),
      );

      const dashboard = await service.getDashboard('league-1');

      expect(dashboard!.upcomingEvents).toHaveLength(20);
      expect(dashboard!.upcomingEvents[0].title).toBe('Contest 1 starts');
      expect(dashboard!.upcomingEvents[19].title).toBe('Contest 20 starts');
    });

    it('returns upcoming events from future contest dates', async () => {
      const service = new DashboardService(
        createMockLeagueRepo(),
        createMockMembershipRepo(),
        createMockContestRepo(),
        createMockInvitationRepo(),
        createMockActionItemRepo(),
      );
      const dashboard = await service.getDashboard('league-1');
      expect(dashboard!.upcomingEvents.length).toBeGreaterThan(0);
      expect(dashboard!.upcomingEvents[0].eventType).toBeDefined();
    });

    it('returns null for missing league', async () => {
      const service = new DashboardService(
        createMockLeagueRepo({ findById: jest.fn().mockResolvedValue(null) }),
        createMockMembershipRepo(),
        createMockContestRepo(),
        createMockInvitationRepo(),
        createMockActionItemRepo(),
      );
      const dashboard = await service.getDashboard('missing');
      expect(dashboard).toBeNull();
    });
  });

  describe('createActionItem', () => {
    it('creates a new action item', async () => {
      const actionItemRepo = createMockActionItemRepo();
      const service = new DashboardService(
        createMockLeagueRepo(),
        createMockMembershipRepo(),
        createMockContestRepo(),
        createMockInvitationRepo(),
        actionItemRepo,
      );
      const item = await service.createActionItem({
        leagueId: 'league-1',
        type: 'PAYOUT_PENDING',
        priority: 'MEDIUM',
        title: 'Confirm payouts for NFL Week 14',
        resolved: false,
      });
      expect(actionItemRepo.create).toHaveBeenCalledTimes(1);
      expect(item.id).toBe('new-ai-id');
    });
  });

  describe('resolveActionItem', () => {
    it('marks an action item as resolved', async () => {
      const actionItemRepo = createMockActionItemRepo();
      const service = new DashboardService(
        createMockLeagueRepo(),
        createMockMembershipRepo(),
        createMockContestRepo(),
        createMockInvitationRepo(),
        actionItemRepo,
      );
      const item = await service.resolveActionItem('ai-1');
      expect(actionItemRepo.resolve).toHaveBeenCalledWith('ai-1');
      expect(item.resolved).toBe(true);
    });
  });
});
