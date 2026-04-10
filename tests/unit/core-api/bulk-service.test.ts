import { BulkService } from '../../../packages/core-api/src/modules/leagues/bulk-service';
import type {
  ContestRepository,
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import { ContestStatus } from '@poolmaster/shared/domain';
import { buildContest, buildLeague, buildMembership, buildInvitation } from '../../factories';

function createMockContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return {
    findById: jest.fn().mockResolvedValue(buildContest()),
    findByLeague: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input, id: 'new-contest', createdAt: new Date(), updatedAt: new Date(),
    })),
    update: jest.fn().mockResolvedValue(buildContest()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return {
    findById: jest.fn().mockResolvedValue(buildLeague({ maxMembers: 20 })),
    create: jest.fn().mockResolvedValue(buildLeague()),
    update: jest.fn().mockResolvedValue(buildLeague()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockMembershipRepo(overrides: Partial<LeagueMembershipRepository> = {}): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn().mockResolvedValue([buildMembership()]),
    findByUser: jest.fn().mockResolvedValue([]),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(buildMembership()),
    update: jest.fn().mockResolvedValue(buildMembership()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockInvitationRepo(overrides: Partial<LeagueInvitationRepository> = {}): LeagueInvitationRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByLeague: jest.fn().mockResolvedValue([]),
    findByCode: jest.fn().mockResolvedValue(null),
    findByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input, id: 'new-invite', createdAt: new Date(), updatedAt: new Date(),
    })),
    update: jest.fn().mockResolvedValue(buildInvitation()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('BulkService', () => {
  describe('copyLastSeason', () => {
    it('copies contests with DRAFT status', async () => {
      const contestRepo = createMockContestRepo();
      const service = new BulkService(
        contestRepo, createMockLeagueRepo(),
        createMockMembershipRepo(), createMockInvitationRepo(),
      );
      const result = await service.copyLastSeason({
        leagueId: 'league-1', createdBy: 'user-1',
        sourceContestIds: ['c-1', 'c-2'],
      });
      expect(result.created).toHaveLength(2);
      const createArg = (contestRepo.create as jest.Mock).mock.calls[0][0];
      expect(createArg.status).toBe(ContestStatus.DRAFT);
      expect(createArg.sportEventId).toBeUndefined();
    });
  });

  describe('importMembersFromCsv', () => {
    it('creates invitations for valid emails', async () => {
      const invitationRepo = createMockInvitationRepo();
      const service = new BulkService(
        createMockContestRepo(), createMockLeagueRepo(),
        createMockMembershipRepo(), invitationRepo,
      );
      const result = await service.importMembersFromCsv('league-1', 'user-1', [
        { email: 'alice@example.com' },
        { email: 'bob@example.com' },
      ]);
      expect(result.sent).toBe(2);
      expect(invitationRepo.create).toHaveBeenCalledTimes(2);
    });

    it('skips invalid emails', async () => {
      const service = new BulkService(
        createMockContestRepo(), createMockLeagueRepo(),
        createMockMembershipRepo(), createMockInvitationRepo(),
      );
      const result = await service.importMembersFromCsv('league-1', 'user-1', [
        { email: 'not-an-email' },
        { email: 'valid@example.com' },
      ]);
      expect(result.sent).toBe(1);
      expect(result.failed).toHaveLength(1);
    });

    it('skips duplicate pending invitations', async () => {
      const invitationRepo = createMockInvitationRepo({
        findByEmail: jest.fn().mockImplementation(async (_lid: string, email: string) => {
          if (email === 'existing@example.com') return buildInvitation({ email });
          return null;
        }),
      });
      const service = new BulkService(
        createMockContestRepo(), createMockLeagueRepo(),
        createMockMembershipRepo(), invitationRepo,
      );
      const result = await service.importMembersFromCsv('league-1', 'user-1', [
        { email: 'existing@example.com' },
        { email: 'new@example.com' },
      ]);
      expect(result.sent).toBe(1);
      expect(result.duplicates).toContain('existing@example.com');
    });
  });
});
