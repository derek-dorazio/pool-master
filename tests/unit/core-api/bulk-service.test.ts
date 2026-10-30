import { BulkService } from '../../../packages/core-api/src/modules/leagues/bulk-service';
import type {
  LeagueInvitationRepository,
  LeagueMembershipRepository,
  LeagueRepository,
} from '@poolmaster/shared/db';
import { buildLeague, buildMembership, buildInvitation } from '../../factories';
import {
  fakeLeagueInvitationRepo,
  fakeLeagueMembershipRepo,
  fakeLeagueRepo,
} from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';

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
    create: mockFn<LeagueInvitationRepository['create']>(async (input) => ({
      ...input, id: 'new-invite', createdAt: new Date(), updatedAt: new Date(),
    })),
    createMany: mockFn<LeagueInvitationRepository['createMany']>(async (inputs) => inputs.map((input) => ({
      ...input, id: 'new-invite', createdAt: new Date(), updatedAt: new Date(),
    }))),
    update: jest.fn().mockResolvedValue(buildInvitation()),
    ...overrides,
  });
}

describe('BulkService', () => {
  // #202 — the last-season copy suite is gone with the method (§1D). The route had no frontend
  // caller and the repo owner removed it from scope.

  describe('importMembersFromCsv', () => {
    it('creates the invitations for every valid email in one write, after one read of the pending ones', async () => {
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
      expect(invitationRepo.findPendingByEmails).toHaveBeenCalledTimes(1);
      expect(jest.mocked(invitationRepo.createMany).mock.calls.map(([rows]) => rows.map((row) => row.email)))
        .toEqual([['alice@example.com', 'bob@example.com']]);
      expect(invitationRepo.create).not.toHaveBeenCalled();
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

    it('invites an address given twice once, counting the second as a duplicate', async () => {
      const invitationRepo = createMockInvitationRepo();
      const service = new BulkService(
        createMockLeagueRepo(),
        createMockMembershipRepo(), invitationRepo,
      );
      const result = await service.importMembersFromCsv('league-1', 'user-1', [
        { email: 'Alice@example.com' },
        { email: 'alice@example.com ' },
      ]);
      expect(result.sent).toBe(1);
      expect(result.duplicates).toEqual(['alice@example.com']);
    });

    it('skips duplicate pending invitations', async () => {
      const invitationRepo = createMockInvitationRepo({
        findPendingByEmails: jest.fn().mockImplementation(async (_leagueId: string, emails: readonly string[]) =>
          emails.filter((email) => email === 'existing@example.com').map((email) => buildInvitation({ email }))),
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
