import { LeagueService, LeagueNotFoundError } from '../../../packages/core-api/src/modules/leagues/service';
import type { LeagueMembershipRepository, LeagueRepository } from '@poolmaster/shared/db';
import { LeagueRole, LeagueVisibility, InvitePolicy, WeekDay } from '@poolmaster/shared/domain';
import { buildLeague, buildMembership } from '../../factories';

function createMockLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-league-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      ...buildLeague({ id }),
      ...updates,
    })),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn().mockResolvedValue([]),
    findByUser: jest.fn().mockResolvedValue([]),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-membership-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockResolvedValue(buildMembership()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('LeagueService', () => {
  describe('createLeague', () => {
    it('creates a league and a COMMISSIONER membership', async () => {
      const leagueRepo = createMockLeagueRepo();
      const membershipRepo = createMockMembershipRepo();
      const service = new LeagueService(leagueRepo, membershipRepo);
      const result = await service.createLeague({
        createdBy: 'user-1',
        name: 'My League',
        visibility: LeagueVisibility.PRIVATE,
      });
      expect(leagueRepo.create).toHaveBeenCalledTimes(1);
      expect(membershipRepo.create).toHaveBeenCalledTimes(1);
      const membershipInput = (membershipRepo.create as jest.Mock).mock.calls[0][0];
      expect(membershipInput.role).toBe(LeagueRole.COMMISSIONER);
      expect(membershipInput.userId).toBe('user-1');
      expect(result.league.id).toBe('new-league-id');
    });

    it('merges default settings with provided overrides', async () => {
      const leagueRepo = createMockLeagueRepo();
      const membershipRepo = createMockMembershipRepo();
      const service = new LeagueService(leagueRepo, membershipRepo);
      await service.createLeague({
        createdBy: 'user-1',
        name: 'My League',
        visibility: LeagueVisibility.PRIVATE,
        settings: { timezone: 'Europe/London', invitePolicy: InvitePolicy.OPEN },
      });
      const createArg = (leagueRepo.create as jest.Mock).mock.calls[0][0];
      const settings = createArg.settings;
      expect(settings.timezone).toBe('Europe/London');
      expect(settings.invitePolicy).toBe('OPEN');
      expect(settings.currency).toBe('USD'); // default preserved
      expect(settings.weeklyRecapDay).toBe(WeekDay.MONDAY); // default preserved
    });

    it('uses default maxMembers when not provided', async () => {
      const leagueRepo = createMockLeagueRepo();
      const membershipRepo = createMockMembershipRepo();
      const service = new LeagueService(leagueRepo, membershipRepo);
      await service.createLeague({
        createdBy: 'user-1',
        name: 'My League',
        visibility: LeagueVisibility.PRIVATE,
      });
      const createArg = (leagueRepo.create as jest.Mock).mock.calls[0][0];
      expect(createArg.maxMembers).toBe(20);
    });
  });

  describe('findByUser', () => {
    it('loads leagues through active memberships instead of tenant scope', async () => {
      const expectedLeague = buildLeague({ id: 'league-1' });
      const expectedMembership = buildMembership({ leagueId: 'league-1', userId: 'user-1' });
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(expectedLeague),
      });
      const membershipRepo = createMockMembershipRepo({
        findByUser: jest.fn().mockResolvedValue([expectedMembership]),
      });
      const service = new LeagueService(leagueRepo, membershipRepo);

      const result = await service.findByUser('user-1');

      expect(membershipRepo.findByUser).toHaveBeenCalledWith('user-1');
      expect(leagueRepo.findById).toHaveBeenCalledWith('league-1');
      expect(result).toEqual([
        {
          league: expectedLeague,
          membership: expectedMembership,
        },
      ]);
    });
  });

  describe('updateSettings', () => {
    it('merges updates with existing settings', async () => {
      const existingLeague = buildLeague({
        id: 'league-1',
        settings: {
          invitePolicy: 'COMMISSIONER_ONLY',
          timezone: 'America/New_York',
          currency: 'USD',
          allowMidSeasonJoin: false,
          requireApproval: false,
          activityFeedEnabled: true,
          weeklyRecapEnabled: false,
          weeklyRecapDay: 'MONDAY',
        },
      });
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(existingLeague),
      });
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());
      await service.updateSettings('league-1', { timezone: 'Europe/London' });
      const updateArg = (leagueRepo.update as jest.Mock).mock.calls[0][1];
      expect((updateArg.settings as Record<string, unknown>).timezone).toBe('Europe/London');
      expect((updateArg.settings as Record<string, unknown>).currency).toBe('USD');
    });

    it('throws LeagueNotFoundError for missing league', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(null),
      });
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());
      await expect(
        service.updateSettings('missing', { timezone: 'UTC' }),
      ).rejects.toThrow(LeagueNotFoundError);
    });
  });

  describe('getLeagueWithMembers', () => {
    it('returns league and members', async () => {
      const league = buildLeague({ id: 'league-1' });
      const members = [buildMembership({ leagueId: 'league-1' })];
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(league),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeague: jest.fn().mockResolvedValue(members),
      });
      const service = new LeagueService(leagueRepo, membershipRepo);
      const result = await service.getLeagueWithMembers('league-1');
      expect(result).not.toBeNull();
      expect(result!.league.id).toBe('league-1');
      expect(result!.members).toHaveLength(1);
    });

    it('returns null for missing league', async () => {
      const leagueRepo = createMockLeagueRepo();
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());
      const result = await service.getLeagueWithMembers('missing');
      expect(result).toBeNull();
    });
  });
});
