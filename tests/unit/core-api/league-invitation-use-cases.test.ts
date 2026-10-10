import { expect } from '@jest/globals';
import {
  InvitationStatus,
  InviteType,
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  type League,
  type User,
} from '@poolmaster/shared/domain';
import {
  InvitationEmailDeliveryError,
  InvitationInvalidError,
  InvitationNotFoundError,
  InvitationService,
} from '../../../packages/core-api/src/modules/leagues/invitation-service';
import type {
  MailDeliveryMessage,
  MailDeliveryProvider,
} from '../../../packages/core-api/src/modules/email/mail-delivery';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';
import { asPrismaClient } from '../../support/prisma-double';
import { expectDefined } from '../../support/expect-defined';

/**
 * League invitation use cases — invite by email, invite link, revoke, preview, accept — against
 * the in-memory league world, asserting the memberships, squads and invitation states each one
 * leaves behind.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function recordingMail(options: { failFor?: string } = {}) {
  const sent: MailDeliveryMessage[] = [];
  const provider: MailDeliveryProvider = {
    providerName: 'smtp',
    send: async (message) => {
      if (options.failFor && message.to === options.failFor) {
        throw new Error('SMTP refused recipient');
      }
      sent.push(message);
      return { provider: 'smtp' };
    },
  };
  return { provider, sent };
}

/** Answers the one Prisma read the join-success email makes: the joining user's team name. */
function teamNamePrisma(world: InMemoryLeagueWorld) {
  return asPrismaClient({
    squadMembership: {
      findFirst: jest.fn(async ({ where }: { where: { leagueId: string; userId: string } }) => {
        const membership = world.squadMembershipOf(where.leagueId, where.userId);
        const squad = membership ? world.tables.squads.get(membership.squadId) : null;
        return squad ? { squad: { name: squad.name } } : null;
      }),
    },
  });
}

function setup(options: { mail?: MailDeliveryProvider; withPrisma?: boolean; appBaseUrl?: string } = {}) {
  const world = inMemoryLeagueWorld();
  const commissioner = world.addUser({ firstName: 'Casey', lastName: 'Commish' });
  const league = world.addLeague({ name: 'Office Pool', leagueCode: 'OFFICE' });
  world.addMember({ league, user: commissioner, role: LeagueRole.COMMISSIONER });
  const service = new InvitationService({
    invitations: world.leagueInvitations,
    memberships: world.memberships,
    leagues: world.leagues,
    squads: world.squads,
    squadMemberships: world.squadMemberships,
    users: world.users,
    ...(options.mail ? { mailDelivery: options.mail } : {}),
    ...(options.withPrisma ? { prisma: teamNamePrisma(world) } : {}),
    ...(options.appBaseUrl ? { appBaseUrl: options.appBaseUrl } : {}),
  });
  return { world, commissioner, league, service };
}

function seedInvitation(
  world: InMemoryLeagueWorld,
  league: League,
  invitedBy: User,
  overrides: Partial<Parameters<InMemoryLeagueWorld['tables']['leagueInvitations']['insert']>[0]> = {},
) {
  return world.tables.leagueInvitations.insert({
    leagueId: league.id,
    email: 'invitee@example.com',
    inviteCode: `code${world.tables.leagueInvitations.rows.size + 1}`,
    inviteType: InviteType.EMAIL,
    status: InvitationStatus.PENDING,
    maxUses: 1,
    currentUses: 0,
    invitedBy: invitedBy.id,
    expiresAt: new Date(Date.now() + DAY_MS),
    ...overrides,
  });
}

describe('InvitationService — inviting by email', () => {
  it('creates one single-use PENDING invitation per address, normalised to lower case, expiring in seven days', async () => {
    const { commissioner, league, service } = setup();
    const before = Date.now();

    const result = await service.sendEmailInvitations({
      leagueId: league.id,
      emails: ['  Alex@Example.com ', 'blair@example.com'],
      invitedBy: commissioner.id,
    });

    expect(result.sent.map((invitation) => invitation.email)).toEqual(['alex@example.com', 'blair@example.com']);
    for (const invitation of result.sent) {
      expect(invitation).toMatchObject({
        inviteType: InviteType.EMAIL,
        status: InvitationStatus.PENDING,
        maxUses: 1,
        currentUses: 0,
      });
      expect(invitation.inviteCode).toMatch(/^[0-9a-f]{12}$/);
      const expiresIn = expectDefined(invitation.expiresAt).getTime() - before;
      expect(expiresIn).toBeGreaterThan(7 * DAY_MS - 60_000);
      expect(expiresIn).toBeLessThan(7 * DAY_MS + 60 * 60 * 1000 + 60_000);
    }
  });

  it('skips an address with a pending invitation, including the same address twice in one batch in different case', async () => {
    const { world, commissioner, league, service } = setup();
    seedInvitation(world, league, commissioner, { email: 'pending@example.com' });

    const result = await service.sendEmailInvitations({
      leagueId: league.id,
      emails: ['pending@example.com', 'new@example.com', 'NEW@example.com'],
      invitedBy: commissioner.id,
    });

    expect(result.sent.map((invitation) => invitation.email)).toEqual(['new@example.com']);
    expect(result.skippedDuplicates).toEqual(['pending@example.com', 'new@example.com']);
  });

  it('skips an address that belongs to an active member and reports it in skippedMembers instead of inviting them', async () => {
    const { world, commissioner, league, service } = setup();
    const member = world.addUser({ email: 'member@example.com' });
    world.addMember({ league, user: member });

    const result = await service.sendEmailInvitations({
      leagueId: league.id,
      emails: ['Member@Example.com', 'outsider@example.com'],
      invitedBy: commissioner.id,
    });

    expect(result.skippedMembers).toEqual(['member@example.com']);
    expect(result.sent.map((invitation) => invitation.email)).toEqual(['outsider@example.com']);
  });

  it('invites a removed member again, because only active members are skipped', async () => {
    const { world, commissioner, league, service } = setup();
    const former = world.addUser({ email: 'former@example.com' });
    const { membership } = world.addMember({ league, user: former });
    world.tables.memberships.patch(membership.id, { status: LeagueMembershipStatus.INACTIVE });

    const result = await service.sendEmailInvitations({
      leagueId: league.id,
      emails: ['former@example.com'],
      invitedBy: commissioner.id,
    });

    expect(result.sent).toHaveLength(1);
    expect(result.skippedMembers).toEqual([]);
  });

  it('re-invites an address whose earlier invitation was revoked', async () => {
    const { world, commissioner, league, service } = setup();
    seedInvitation(world, league, commissioner, { email: 'again@example.com', status: InvitationStatus.REVOKED });

    const result = await service.sendEmailInvitations({
      leagueId: league.id,
      emails: ['again@example.com'],
      invitedBy: commissioner.id,
    });

    expect(result.sent).toHaveLength(1);
  });

  it('emails each invitee a link to /invite/<code> on the app base URL, signed with the inviter\'s full name', async () => {
    const mail = recordingMail();
    const { commissioner, league, service } = setup({ mail: mail.provider, appBaseUrl: 'https://pool.example.com///' });

    const { sent } = await service.sendEmailInvitations({
      leagueId: league.id,
      emails: ['alex@example.com'],
      invitedBy: commissioner.id,
      message: 'Join us for the Masters',
    });

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({
      to: 'alex@example.com',
      metadata: { templateKey: 'LEAGUE_MEMBER_INVITE', invitationId: sent[0].id },
    });
    expect(mail.sent[0].text).toContain(`https://pool.example.com/invite/${sent[0].inviteCode}`);
    expect(mail.sent[0].text).toContain('Casey Commish');
    expect(mail.sent[0].text).toContain('Office Pool');
    expect(mail.sent[0].text).toContain('Join us for the Masters');
  });

  it.each([
    ['username when the inviter has no name', { firstName: ' ', lastName: '' }, 'casey-handle'],
    ['email when the inviter has neither name nor username', { firstName: '', lastName: '', username: '' }, 'casey@example.com'],
  ])('signs the invitation with the %s', async (_case, overrides, expected) => {
    const mail = recordingMail();
    const { world, league, service } = setup({ mail: mail.provider });
    const inviter = world.addUser({ username: 'casey-handle', email: 'casey@example.com', ...overrides });

    await service.sendEmailInvitations({ leagueId: league.id, emails: ['x@example.com'], invitedBy: inviter.id });

    expect(mail.sent[0].text).toContain(expected);
  });

  it('signs the invitation "League commissioner" when the inviter account cannot be found', async () => {
    const mail = recordingMail();
    const { league, service } = setup({ mail: mail.provider });

    await service.sendEmailInvitations({ leagueId: league.id, emails: ['x@example.com'], invitedBy: 'gone-user' });

    expect(mail.sent[0].text).toContain('League commissioner');
  });

  it('throws InvitationEmailDeliveryError naming the stored invitation when the mail provider fails', async () => {
    const mail = recordingMail({ failFor: 'bounce@example.com' });
    const { world, commissioner, league, service } = setup({ mail: mail.provider });

    const attempt = service.sendEmailInvitations({
      leagueId: league.id,
      emails: ['bounce@example.com'],
      invitedBy: commissioner.id,
    });

    await expect(attempt).rejects.toBeInstanceOf(InvitationEmailDeliveryError);
    const [stored] = world.tables.leagueInvitations.where(() => true);
    await expect(attempt).rejects.toMatchObject({ invitationId: stored.id, email: 'bounce@example.com' });
  });
});

describe('InvitationService — invite links', () => {
  it('creates an unlimited, non-expiring LINK invitation when no limits are given', async () => {
    const { commissioner, league, service } = setup();

    const link = await service.generateInviteLink({ leagueId: league.id, invitedBy: commissioner.id });

    expect(link).toMatchObject({ inviteType: InviteType.LINK, maxUses: 0, status: InvitationStatus.PENDING });
    expect(link.expiresAt).toBeUndefined();
    expect(link.email).toBeUndefined();
  });

  it('sets the use limit and an expiry the given number of days out', async () => {
    const { commissioner, league, service } = setup();
    const before = Date.now();

    const link = await service.generateInviteLink({
      leagueId: league.id,
      invitedBy: commissioner.id,
      expiresInDays: 3,
      maxUses: 5,
    });

    expect(link.maxUses).toBe(5);
    expect(expectDefined(link.expiresAt).getTime() - before).toBeGreaterThan(3 * DAY_MS - 60 * 60 * 1000 - 60_000);
    expect(expectDefined(link.expiresAt).getTime() - before).toBeLessThan(3 * DAY_MS + 60 * 60 * 1000 + 60_000);
  });

  it('lets several people join through one link until its use limit, then marks it ACCEPTED and refuses the next', async () => {
    const { world, commissioner, league, service } = setup();
    const link = await service.generateInviteLink({ leagueId: league.id, invitedBy: commissioner.id, maxUses: 2 });
    const [first, second, third] = [world.addUser(), world.addUser(), world.addUser()];

    await service.acceptInvitation(link.inviteCode, first.id);
    expect(world.tables.leagueInvitations.get(link.id)).toMatchObject({ currentUses: 1, status: InvitationStatus.PENDING });
    await service.acceptInvitation(link.inviteCode, second.id);
    expect(world.tables.leagueInvitations.get(link.id)).toMatchObject({ currentUses: 2, status: InvitationStatus.ACCEPTED });

    await expect(service.acceptInvitation(link.inviteCode, third.id))
      .rejects.toMatchObject({ code: 'LEAGUE_INVITATION_ALREADY_ACCEPTED' });
    expect(world.membershipOf(league.id, third.id)).toBeNull();
  });

  it('keeps an unlimited link PENDING however many people join through it', async () => {
    const { world, commissioner, league, service } = setup();
    const link = await service.generateInviteLink({ leagueId: league.id, invitedBy: commissioner.id });

    for (let index = 0; index < 3; index += 1) {
      await service.acceptInvitation(link.inviteCode, world.addUser().id);
    }

    expect(world.tables.leagueInvitations.get(link.id)).toMatchObject({ currentUses: 3, status: InvitationStatus.PENDING });
  });

  it('refuses a link whose uses are already exhausted with LEAGUE_INVITATION_EXHAUSTED', async () => {
    const { world, commissioner, league, service } = setup();
    const invitation = seedInvitation(world, league, commissioner, { inviteType: InviteType.LINK, maxUses: 2, currentUses: 2 });

    await expect(service.acceptInvitation(invitation.inviteCode, world.addUser().id))
      .rejects.toMatchObject({ code: 'LEAGUE_INVITATION_EXHAUSTED' });
  });
});

describe('InvitationService — revoking', () => {
  it('revokes a pending invitation so it can no longer be accepted', async () => {
    const { world, commissioner, league, service } = setup();
    const invitation = seedInvitation(world, league, commissioner);

    await service.revokeInviteLink(league.id, invitation.inviteCode);

    expect(world.tables.leagueInvitations.get(invitation.id)?.status).toBe(InvitationStatus.REVOKED);
    await expect(service.acceptInvitation(invitation.inviteCode, world.addUser().id))
      .rejects.toMatchObject({ code: 'LEAGUE_INVITATION_REVOKED' });
  });

  it('refuses to revoke another league\'s invitation as not found, leaving it pending', async () => {
    const { world, commissioner, service } = setup();
    const otherLeague = world.addLeague();
    const invitation = seedInvitation(world, otherLeague, commissioner);
    const ownLeague = world.addLeague();

    await expect(service.revokeInviteLink(ownLeague.id, invitation.inviteCode)).rejects.toBeInstanceOf(InvitationNotFoundError);
    expect(world.tables.leagueInvitations.get(invitation.id)?.status).toBe(InvitationStatus.PENDING);
  });

  it('refuses to revoke an unknown code as not found', async () => {
    const { league, service } = setup();
    await expect(service.revokeInviteLink(league.id, 'unknown')).rejects.toThrow('Invitation not found: unknown');
  });
});

describe('InvitationService — accepting', () => {
  it('makes a newcomer an ACTIVE MEMBER with a team of their own and marks the email invitation ACCEPTED by them', async () => {
    const { world, commissioner, league, service } = setup();
    const invitation = seedInvitation(world, league, commissioner);
    const newcomer = world.addUser({ firstName: 'Nia', lastName: 'New', email: 'invitee@example.com' });

    const membership = await service.acceptInvitation(invitation.inviteCode, newcomer.id);

    expect(membership).toMatchObject({ role: LeagueRole.MEMBER, status: LeagueMembershipStatus.ACTIVE });
    expect(world.squadMembershipOf(league.id, newcomer.id)?.status).toBe(SquadMembershipStatus.ACTIVE);
    expect(world.tables.leagueInvitations.get(invitation.id)).toMatchObject({
      status: InvitationStatus.ACCEPTED,
      currentUses: 1,
      acceptedBy: newcomer.id,
    });
  });

  it('refuses an active member with LEAGUE_ALREADY_MEMBER without consuming a use of the invitation', async () => {
    const { world, commissioner, league, service } = setup();
    const invitation = seedInvitation(world, league, commissioner, { inviteType: InviteType.LINK, maxUses: 0 });

    await expect(service.acceptInvitation(invitation.inviteCode, commissioner.id))
      .rejects.toMatchObject({ code: 'LEAGUE_ALREADY_MEMBER' });
    expect(world.tables.leagueInvitations.get(invitation.id)?.currentUses).toBe(0);
    expect(world.membershipOf(league.id, commissioner.id)?.role).toBe(LeagueRole.COMMISSIONER);
  });

  it('brings a removed member back as an ACTIVE MEMBER on their original, reactivated team', async () => {
    const { world, commissioner, league, service } = setup();
    const former = world.addUser({ email: 'invitee@example.com' });
    const { membership, squad } = world.addMember({ league, user: former, role: LeagueRole.COMMISSIONER });
    world.tables.memberships.patch(membership.id, { status: LeagueMembershipStatus.INACTIVE });
    const formerSquadMembership = expectDefined(world.squadMembershipOf(league.id, former.id));
    world.tables.squadMemberships.patch(formerSquadMembership.id, { status: SquadMembershipStatus.INACTIVE });
    world.tables.squads.patch(squad.id, { isActive: false });
    const invitation = seedInvitation(world, league, commissioner);

    const rejoined = await service.acceptInvitation(invitation.inviteCode, former.id);

    expect(rejoined.id).toBe(membership.id);
    expect(world.membershipOf(league.id, former.id)).toMatchObject({
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
    });
    expect(world.squadMembershipOf(league.id, former.id)).toMatchObject({
      squadId: squad.id,
      status: SquadMembershipStatus.ACTIVE,
    });
    expect(world.tables.squads.get(squad.id)?.isActive).toBe(true);
  });

  it('marks a past-expiry invitation EXPIRED and refuses it with LEAGUE_INVITATION_EXPIRED, then keeps refusing it', async () => {
    const { world, commissioner, league, service } = setup();
    const invitation = seedInvitation(world, league, commissioner, { expiresAt: new Date(Date.now() - 1000) });
    const user = world.addUser();

    await expect(service.acceptInvitation(invitation.inviteCode, user.id))
      .rejects.toMatchObject({ code: 'LEAGUE_INVITATION_EXPIRED', message: 'Invitation has expired' });
    expect(world.tables.leagueInvitations.get(invitation.id)?.status).toBe(InvitationStatus.EXPIRED);
    await expect(service.acceptInvitation(invitation.inviteCode, user.id))
      .rejects.toMatchObject({ code: 'LEAGUE_INVITATION_EXPIRED', message: 'Invitation is expired' });
    expect(world.membershipOf(league.id, user.id)).toBeNull();
  });

  it('refuses an already-accepted invitation with LEAGUE_INVITATION_ALREADY_ACCEPTED', async () => {
    const { world, commissioner, league, service } = setup();
    const invitation = seedInvitation(world, league, commissioner, { status: InvitationStatus.ACCEPTED });

    const attempt = service.acceptInvitation(invitation.inviteCode, world.addUser().id);

    await expect(attempt).rejects.toBeInstanceOf(InvitationInvalidError);
    await expect(attempt).rejects.toMatchObject({ code: 'LEAGUE_INVITATION_ALREADY_ACCEPTED' });
  });

  it('refuses an unknown invite code with InvitationNotFoundError', async () => {
    const { world, service } = setup();
    await expect(service.acceptInvitation('nope', world.addUser().id)).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it('refuses an invitation whose league no longer exists with LEAGUE_NOT_FOUND and creates no membership', async () => {
    const { world, commissioner, service } = setup();
    const doomed = world.addLeague();
    const invitation = seedInvitation(world, doomed, commissioner);
    world.tables.leagues.remove(doomed.id);
    const user = world.addUser({ email: 'invitee@example.com' });

    await expect(service.acceptInvitation(invitation.inviteCode, user.id))
      .rejects.toMatchObject({ code: 'LEAGUE_NOT_FOUND' });
    expect(world.membershipOf(doomed.id, user.id)).toBeNull();
  });

  it('emails the new member a welcome naming their team and linking to the league home', async () => {
    const mail = recordingMail();
    const { world, commissioner, league, service } = setup({ mail: mail.provider, withPrisma: true });
    const invitation = seedInvitation(world, league, commissioner, { email: 'nia@example.com' });
    const newcomer = world.addUser({ firstName: 'Nia', lastName: 'New', email: 'nia@example.com' });

    await service.acceptInvitation(invitation.inviteCode, newcomer.id);

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'nia@example.com', metadata: { templateKey: 'LEAGUE_JOIN_SUCCESS' } });
    expect(mail.sent[0].text).toContain('Nia New');
    expect(mail.sent[0].text).toContain('/league/OFFICE');
  });

  it('still completes the join when the welcome email fails to send', async () => {
    const mail = recordingMail({ failFor: 'nia@example.com' });
    const { world, commissioner, league, service } = setup({ mail: mail.provider, withPrisma: true });
    const invitation = seedInvitation(world, league, commissioner, { email: 'nia@example.com' });
    const newcomer = world.addUser({ email: 'nia@example.com' });

    await expect(service.acceptInvitation(invitation.inviteCode, newcomer.id)).resolves.toMatchObject({
      status: LeagueMembershipStatus.ACTIVE,
    });
    expect(world.tables.leagueInvitations.get(invitation.id)?.status).toBe(InvitationStatus.ACCEPTED);
  });
});

describe('InvitationService — who may accept, and inactive leagues', () => {
  it('refuses an email invitation accepted by an account with a different email, with LEAGUE_INVITATION_EMAIL_MISMATCH', async () => {
    const { world, commissioner, league, service } = setup();
    const invitation = seedInvitation(world, league, commissioner, { email: 'invitee@example.com' });
    const forwardedTo = world.addUser({ email: 'someone-else@example.com' });

    await expect(service.acceptInvitation(invitation.inviteCode, forwardedTo.id))
      .rejects.toMatchObject({ code: 'LEAGUE_INVITATION_EMAIL_MISMATCH' });
    expect(world.membershipOf(league.id, forwardedTo.id)).toBeNull();
    expect(world.tables.leagueInvitations.get(invitation.id)).toMatchObject({
      status: InvitationStatus.PENDING,
      currentUses: 0,
    });
  });

  it('accepts an email invitation when the account email differs only in case', async () => {
    const { world, commissioner, league, service } = setup();
    const invitation = seedInvitation(world, league, commissioner, { email: 'invitee@example.com' });
    const invitee = world.addUser({ email: 'Invitee@Example.com' });

    await expect(service.acceptInvitation(invitation.inviteCode, invitee.id))
      .resolves.toMatchObject({ status: LeagueMembershipStatus.ACTIVE });
  });

  it('lets anyone holding a LINK invitation join, whatever their email', async () => {
    const { world, commissioner, league, service } = setup();
    const link = await service.generateInviteLink({ leagueId: league.id, invitedBy: commissioner.id });
    const anyone = world.addUser({ email: 'anyone@example.com' });

    await expect(service.acceptInvitation(link.inviteCode, anyone.id))
      .resolves.toMatchObject({ status: LeagueMembershipStatus.ACTIVE });
  });

  it('refuses to send email invitations for an inactive league with LEAGUE_INACTIVE, recording none', async () => {
    const { world, commissioner, league, service } = setup();
    world.tables.leagues.patch(league.id, { isActive: false });

    await expect(service.sendEmailInvitations({
      leagueId: league.id,
      emails: ['alex@example.com'],
      invitedBy: commissioner.id,
    })).rejects.toMatchObject({ code: 'LEAGUE_INACTIVE' });
    expect(world.tables.leagueInvitations.where(() => true)).toEqual([]);
  });

  it('refuses to create an invite link for an inactive league with LEAGUE_INACTIVE', async () => {
    const { world, commissioner, league, service } = setup();
    world.tables.leagues.patch(league.id, { isActive: false });

    await expect(service.generateInviteLink({ leagueId: league.id, invitedBy: commissioner.id }))
      .rejects.toMatchObject({ code: 'LEAGUE_INACTIVE' });
    expect(world.tables.leagueInvitations.where(() => true)).toEqual([]);
  });

  it('refuses to resend an email invitation for an inactive league with LEAGUE_INACTIVE, sending nothing and keeping its code', async () => {
    const mail = recordingMail();
    const { world, commissioner, league, service } = setup({ mail: mail.provider });
    const invitation = seedInvitation(world, league, commissioner, { email: 'invitee@example.com' });
    world.tables.leagues.patch(league.id, { isActive: false });

    await expect(service.resendEmailInvitation(league.id, invitation.id, commissioner.id))
      .rejects.toMatchObject({ code: 'LEAGUE_INACTIVE' });
    expect(mail.sent).toEqual([]);
    expect(world.tables.leagueInvitations.get(invitation.id)?.inviteCode).toBe(invitation.inviteCode);
  });

  it('refuses to accept an invitation into an inactive league with LEAGUE_INACTIVE, creating no membership', async () => {
    const { world, commissioner, league, service } = setup();
    const invitation = seedInvitation(world, league, commissioner, { inviteType: InviteType.LINK, maxUses: 0 });
    world.tables.leagues.patch(league.id, { isActive: false });
    const newcomer = world.addUser();

    await expect(service.acceptInvitation(invitation.inviteCode, newcomer.id))
      .rejects.toMatchObject({ code: 'LEAGUE_INACTIVE' });
    expect(world.membershipOf(league.id, newcomer.id)).toBeNull();
    expect(world.tables.leagueInvitations.get(invitation.id)?.currentUses).toBe(0);
  });
});

describe('InvitationService — preview', () => {
  it('shows the invitation status and the league it is for, without needing an account', async () => {
    const { world, commissioner, league, service } = setup();
    const invitation = seedInvitation(world, league, commissioner, { status: InvitationStatus.REVOKED });

    await expect(service.getInvitationPreview(invitation.inviteCode)).resolves.toEqual({
      inviteCode: invitation.inviteCode,
      status: InvitationStatus.REVOKED,
      league: { id: league.id, leagueCode: 'OFFICE', name: 'Office Pool' },
    });
  });

  it('refuses an unknown code as not found and a deleted league as LEAGUE_NOT_FOUND', async () => {
    const { world, commissioner, service } = setup();
    const doomed = world.addLeague();
    const invitation = seedInvitation(world, doomed, commissioner);
    world.tables.leagues.remove(doomed.id);

    await expect(service.getInvitationPreview('nope')).rejects.toBeInstanceOf(InvitationNotFoundError);
    await expect(service.getInvitationPreview(invitation.inviteCode)).rejects.toMatchObject({ code: 'LEAGUE_NOT_FOUND' });
  });
});
