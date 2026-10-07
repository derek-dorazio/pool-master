import { DashboardService } from '../../../packages/core-api/src/modules/leagues/dashboard-service';
import type {
  ContestRepository,
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import { ContestStatus, InvitationStatus } from '@poolmaster/shared/domain';
import { buildContest, buildInvitation, buildLeague, buildMembership } from '../../factories';
import {
  fakeContestRepo,
  fakeLeagueInvitationRepo,
  fakeLeagueMembershipRepo,
  fakeLeagueRepo,
} from '../../support/repo-fakes';

function createMockLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return fakeLeagueRepo({
    findById: jest.fn().mockResolvedValue(buildLeague({ id: 'league-1' })),
    create: jest.fn().mockResolvedValue(buildLeague()),
    update: jest.fn().mockResolvedValue(buildLeague()),
    ...overrides,
  });
}

function createMockMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return fakeLeagueMembershipRepo({
    findByLeague: jest.fn().mockResolvedValue([
      buildMembership({ userId: 'user-1' }),
      buildMembership({ userId: 'user-2' }),
    ]),
    create: jest.fn().mockResolvedValue(buildMembership()),
    update: jest.fn().mockResolvedValue(buildMembership()),
    ...overrides,
  });
}

function createMockContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return fakeContestRepo({
    findByLeague: jest.fn().mockResolvedValue([
      buildContest({ name: 'Active Pool', status: ContestStatus.ACTIVE }),
      buildContest({
        name: 'Future Pool',
        status: ContestStatus.DRAFT,
        startsAt: new Date('2099-06-01'),
      }),
    ]),
    update: jest.fn().mockResolvedValue(buildContest()),
    ...overrides,
  });
}

function createMockInvitationRepo(
  overrides: Partial<LeagueInvitationRepository> = {},
): LeagueInvitationRepository {
  return fakeLeagueInvitationRepo({
    findByLeague: jest.fn().mockResolvedValue([
      buildInvitation({ status: InvitationStatus.PENDING }),
      buildInvitation({ status: InvitationStatus.PENDING }),
      buildInvitation({ status: InvitationStatus.ACCEPTED }),
    ]),
    create: jest.fn().mockResolvedValue(buildInvitation()),
    update: jest.fn().mockResolvedValue(buildInvitation()),
    ...overrides,
  });
}

describe('DashboardService', () => {
  describe('getDashboard', () => {
    it('returns full dashboard with all widgets', async () => {
      const service = new DashboardService(
        createMockLeagueRepo(),
        createMockMembershipRepo(),
        createMockContestRepo(),
        createMockInvitationRepo(),
      );
      const dashboard = await service.getDashboard('league-1');
      expect(dashboard).not.toBeNull();
      expect(dashboard!.league.id).toBe('league-1');
      expect(dashboard!.memberCount).toBe(2);
      expect(dashboard!.pendingInvites).toBe(2);
      expect(dashboard!.contests).toHaveLength(2);
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
      );
      const dashboard = await service.getDashboard('missing');
      expect(dashboard).toBeNull();
    });
  });

  // #202 — the `createActionItem` and `resolveActionItem` suites went with their methods (§1D),
  // and #205 dropped the action-item table and the dashboard's `actionItems` with them.
});
