/**
 * #1357 — a paste of email invites writes its invitations and their invite emails in one
 * transaction against real Postgres: when the outbox write fails, neither is kept, so the same
 * paste again invites and emails everyone instead of skipping them as pending.
 */
import type { InvitationEmailTransaction } from '@poolmaster/shared/db';
import { LeagueIconKey, LeaguePlan } from '@poolmaster/shared/domain';
import {
  PrismaInvitationEmailTransaction,
  PrismaLeagueInvitationRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaUserRepository,
} from '../../../packages/core-api/src/adapters';
import { InvitationService } from '../../../packages/core-api/src/modules/leagues/invitation-service';
import { emailServiceInto } from '../../support/email-service';
import {
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

const LEAGUE_CODE = `INVMAIL${Date.now().toString(36).toUpperCase()}`;

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  const league = { leagueCode: LEAGUE_CODE };
  await prisma.emailMessage.deleteMany({ where: { league } });
  await prisma.leagueInvitation.deleteMany({ where: { league } });
  await prisma.league.deleteMany({ where: league });
  await teardownIntegrationTests();
});

/** The real transaction, with an outbox write that records the emails and then fails. */
function failingOutbox(transaction: InvitationEmailTransaction): InvitationEmailTransaction {
  return {
    run: (work) => transaction.run((repos) => work({
      ...repos,
      emails: {
        recordMany: async (records) => {
          await repos.emails.recordMany(records);
          throw new Error('outbox write failed');
        },
      },
    })),
  };
}

function invitationService(invitationEmails: InvitationEmailTransaction): InvitationService {
  const prisma = getAppPrisma();
  return new InvitationService({
    invitations: new PrismaLeagueInvitationRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    leagues: new PrismaLeagueRepository(prisma),
    users: new PrismaUserRepository(prisma),
    contests: { findOpenByLeague: async () => [] },
    memberJoined: { tellJoined: async () => undefined },
    email: emailServiceInto(),
    invitationEmails,
  });
}

describe('league email invites (#1357)', () => {
  it('keeps neither the invitations nor their emails when the outbox write fails, and the same paste again invites and emails everyone', async () => {
    const prisma = getPrisma();
    const { user } = await createTestUser({ lastName: 'InviteMailer' });
    const league = await prisma.league.create({
      data: { cupName: 'Test Cup', leagueCode: LEAGUE_CODE, name: 'Invite Mail', iconKey: LeagueIconKey.TROPHY, plan: LeaguePlan.PREMIUM },
    });
    const transaction = new PrismaInvitationEmailTransaction(getAppPrisma());
    const paste = { leagueId: league.id, emails: ['ann@integration.test', 'ben@integration.test'], invitedBy: user.id };

    await expect(invitationService(failingOutbox(transaction)).sendEmailInvitations(paste)).rejects.toThrow('outbox write failed');
    await expect(prisma.leagueInvitation.count({ where: { leagueId: league.id } })).resolves.toBe(0);
    await expect(prisma.emailMessage.count({ where: { leagueId: league.id } })).resolves.toBe(0);

    const again = await invitationService(transaction).sendEmailInvitations(paste);

    expect(again.skippedDuplicates).toEqual([]);
    const invitations = await prisma.leagueInvitation.findMany({ where: { leagueId: league.id }, orderBy: { email: 'asc' } });
    expect(invitations.map((row) => row.email)).toEqual(['ann@integration.test', 'ben@integration.test']);
    const emails = await prisma.emailMessage.findMany({ where: { leagueId: league.id }, orderBy: { recipientEmail: 'asc' } });
    expect(emails.map((row) => [row.recipientEmail, row.invitationId, row.templateKey]))
      .toEqual(invitations.map((row) => [row.email, row.id, 'LEAGUE_MEMBER_INVITE']));
  });
});
