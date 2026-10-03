import { BulkService } from '../../../packages/core-api/src/modules/leagues/bulk-service';
import type {
  ContestRepository,
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import { ContestStatus } from '@poolmaster/shared/domain';
import { buildContest, buildLeague, buildMembership, buildInvitation } from '../../factories';
import {
  fakeContestRepo,
  fakeLeagueInvitationRepo,
  fakeLeagueMembershipRepo,
  fakeLeagueRepo,
} from '../../support/repo-fakes';

function createMockContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return fakeContestRepo({
    findById: jest.fn().mockResolvedValue(buildContest()),
    update: jest.fn().mockResolvedValue(buildContest()),
    ...overrides,
  });
}

function createMockLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return fakeLeagueRepo({
    findById: jest.fn().mockResolvedValue(buildLeague()),
    create: jest.fn().mockResolvedValue(buildLeague()),
    update: jest.fn().mockResolvedValue(buildLeague()),
    ...overrides,
  });
}

function createMockMembershipRepo(overrides: Partial<LeagueMembershipRepository> = {}): LeagueMembershipRepository {
  return fakeLeagueMembershipRepo({
    findByLeague: jest.fn().mockResolvedValue([buildMembership()]),
    create: jest.fn().mockResolvedValue(buildMembership()),
    update: jest.fn().mockResolvedValue(buildMembership()),
    ...overrides,
  });
}

function createMockInvitationRepo(overrides: Partial<LeagueInvitationRepository> = {}): LeagueInvitationRepository {
  return fakeLeagueInvitationRepo({
    create: jest.fn().mockImplementation(async (input) => ({
      ...input, id: 'new-invite', createdAt: new Date(), updatedAt: new Date(),
    })),
    update: jest.fn().mockResolvedValue(buildInvitation()),
    ...overrides,
  });
}

describe('BulkService', () => {
  // #202 — the last-season copy suite is gone with the method (§1D). The route had no frontend
  // caller and the repo owner removed it from scope.

  describe('importMembersFromCsv', () => {
    it('creates invitations for valid emails', async () => {
      const invitationRepo = createMockInvitationRepo();
      const service = new BulkService(
        createMockLeagueRepo(),
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
        createMockLeagueRepo(),
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
        createMockLeagueRepo(),
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
