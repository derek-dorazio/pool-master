import { expect } from '@jest/globals';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus,
  type League,
  type Squad,
  type User,
} from '@poolmaster/shared/domain';
import {
  SquadOwnerInvitationNotFoundError,
  SquadOwnerInvitationOperationError,
  SquadOwnerInvitationService,
} from '../../../packages/core-api/src/modules/squads/owner-invitation-service';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';
import { inMemoryEmailMessages, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';
import { emailServiceInto } from '../../support/email-service';
import { fakeLogger } from '../../support/fake-logger';
import type { EmailService } from '../../../packages/core-api/src/modules/email';
import type { FastifyBaseLogger } from 'fastify';
import { asPrismaClient } from '../../support/prisma-double';
import { expectDefined } from '../../support/expect-defined';

/**
 * Team-owner invitation use cases — invite a co-owner, replace an owner, revoke, preview,
 * register-and-accept, accept — against the in-memory league world. Each asserts who ends up
 * owning which team and as what kind of league member, not which repository calls were made.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface League3 {
  world: InMemoryLeagueWorld;
  league: League;
  commissioner: User;
  commissionerSquad: Squad;
  owner: User;
  ownerSquad: Squad;
  service: SquadOwnerInvitationService;
  /** Every email the service queued: co-owner invitations (B4) and "you were added" (B5). */
  outbox: InMemoryEmailMessages;
  email: EmailService;
  logger: jest.Mocked<FastifyBaseLogger>;
}

/** A league with a commissioner on their own team and one member who owns a team alone. */
function leagueWithTwoTeams(): League3 {
  const world = inMemoryLeagueWorld();
  const league = world.addLeague({ name: 'Office Pool', leagueCode: 'OFFICE' });
  const commissioner = world.addUser({ firstName: 'Casey', lastName: 'Commish' });
  const owner = world.addUser({ firstName: 'Olive', lastName: 'Owner' });
  const { squad: commissionerSquad } = world.addMember({ league, user: commissioner, role: LeagueRole.COMMISSIONER });
  const { squad: ownerSquad } = world.addMember({ league, user: owner });
  const prisma = asPrismaClient({
    league: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => world.tables.leagues.get(where.id)),
    },
  });
  const outbox = inMemoryEmailMessages();
  const email = emailServiceInto(outbox);
  const logger = fakeLogger();
  const service = new SquadOwnerInvitationService({
    squadOwnerInvitations: world.ownerInvitations,
    leagueMemberships: world.memberships,
    squads: world.squads,
    squadMemberships: world.squadMemberships,
    membershipTransaction: world.transaction,
    users: world.users,
    prisma,
    email,
    appBaseUrl: 'https://app.example.test/',
    logger,
  });
  return { world, league, commissioner, commissionerSquad, owner, ownerSquad, service, outbox, email, logger };
}

function seedOwnerInvitation(
  setup: League3,
  overrides: Partial<Parameters<InMemoryLeagueWorld['tables']['ownerInvitations']['insert']>[0]> = {},
) {
  return setup.world.tables.ownerInvitations.insert({
    leagueId: setup.league.id,
    squadId: setup.ownerSquad.id,
    email: 'newcomer@example.com',
    inviteCode: `owner${setup.world.tables.ownerInvitations.rows.size + 1}`,
    status: SquadOwnerInvitationStatus.PENDING,
    invitedBy: setup.owner.id,
    expiresAt: new Date(Date.now() + DAY_MS),
    ...overrides,
  });
}

function ownersOf(world: InMemoryLeagueWorld, squadId: string): string[] {
  return world.tables.squadMemberships
    .where((row) => row.squadId === squadId && row.status === SquadMembershipStatus.ACTIVE)
    .map((row) => row.userId)
    .sort();
}

describe('SquadOwnerInvitationService — inviting a co-owner', () => {
  it('records a PENDING invitation for an address with no account, lower-cased, expiring in seven days', async () => {
    const setup = leagueWithTwoTeams();
    const before = Date.now();

    const invitation = await setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: '  Pat@Example.com ',
    });

    expect(invitation).toMatchObject({
      email: 'pat@example.com',
      status: SquadOwnerInvitationStatus.PENDING,
      invitedBy: setup.owner.id,
      acceptedBy: null,
      replacementForUserId: null,
      team: { id: setup.ownerSquad.id, name: setup.ownerSquad.name },
    });
    const expiresIn = Date.parse(expectDefined(invitation.expiresAt)) - before;
    expect(expiresIn).toBeGreaterThan(7 * DAY_MS - 60 * 60 * 1000 - 60_000);
    expect(expiresIn).toBeLessThan(7 * DAY_MS + 60 * 60 * 1000 + 60_000);
    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([setup.owner.id]);
  });

  it('adds an existing account straight onto the team as an ACTIVE MEMBER and marks the invitation ACCEPTED', async () => {
    const setup = leagueWithTwoTeams();
    const pat = setup.world.addUser({ email: 'pat@example.com' });

    const invitation = await setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: 'pat@example.com',
    });

    expect(invitation).toMatchObject({ status: SquadOwnerInvitationStatus.ACCEPTED, acceptedBy: pat.id });
    expect(setup.world.membershipOf(setup.league.id, pat.id)).toMatchObject({
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
    });
    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([setup.owner.id, pat.id].sort());
  });

  it('leaves an existing account out of the league and records no invitation when seating them on the team fails part way', async () => {
    const setup = leagueWithTwoTeams();
    const pat = setup.world.addUser({ email: 'pat@example.com' });
    jest.spyOn(setup.world.squadMemberships, 'create').mockRejectedValue(new Error('database unavailable'));

    await expect(setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: 'pat@example.com',
    })).rejects.toThrow('database unavailable');

    expect(setup.world.membershipOf(setup.league.id, pat.id)).toBeNull();
    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([setup.owner.id]);
    expect(setup.world.tables.ownerInvitations.where(() => true)).toEqual([]);
  });

  it('brings a removed member back as co-owner of the inviting team, moving them off their old team', async () => {
    const setup = leagueWithTwoTeams();
    const former = setup.world.addUser({ email: 'former@example.com' });
    const { membership, squad: oldSquad } = setup.world.addMember({ league: setup.league, user: former });
    setup.world.tables.memberships.patch(membership.id, { status: LeagueMembershipStatus.INACTIVE });
    const oldSquadMembership = expectDefined(setup.world.squadMembershipOf(setup.league.id, former.id));
    setup.world.tables.squadMemberships.patch(oldSquadMembership.id, { status: SquadMembershipStatus.INACTIVE });

    await setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: 'former@example.com',
    });

    expect(setup.world.membershipOf(setup.league.id, former.id)?.status).toBe(LeagueMembershipStatus.ACTIVE);
    expect(setup.world.squadMembershipOf(setup.league.id, former.id)).toMatchObject({
      squadId: setup.ownerSquad.id,
      status: SquadMembershipStatus.ACTIVE,
    });
    expect(ownersOf(setup.world, oldSquad.id)).toEqual([]);
  });

  it('refuses an address that already belongs to an active league member, recording no invitation', async () => {
    const setup = leagueWithTwoTeams();

    await expect(setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: setup.commissioner.email,
    })).rejects.toMatchObject({ code: 'SQUAD_OWNER_INVITATION_LEAGUE_MEMBER_CONFLICT' });
    expect(setup.world.tables.ownerInvitations.where(() => true)).toEqual([]);
  });

  it('refuses a second pending invitation for the same address anywhere in the league', async () => {
    const setup = leagueWithTwoTeams();
    seedOwnerInvitation(setup, { email: 'pat@example.com', squadId: setup.commissionerSquad.id });

    await expect(setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: 'PAT@example.com',
    })).rejects.toMatchObject({ code: 'SQUAD_OWNER_INVITATION_DUPLICATE' });
  });

  it('refuses an owner inviting onto a team they do not own with SQUAD_OWNER_SCOPE_FORBIDDEN', async () => {
    const setup = leagueWithTwoTeams();

    await expect(setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.commissionerSquad.id,
      actorUserId: setup.owner.id,
      email: 'pat@example.com',
    })).rejects.toMatchObject({ code: 'SQUAD_OWNER_SCOPE_FORBIDDEN' });
  });

  it('lets a commissioner invite a co-owner onto any team in their league', async () => {
    const setup = leagueWithTwoTeams();

    await expect(setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.commissioner.id,
      email: 'pat@example.com',
    })).resolves.toMatchObject({ status: SquadOwnerInvitationStatus.PENDING, squadId: setup.ownerSquad.id });
  });

  it('refuses someone outside the league with LEAGUE_MEMBERSHIP_REQUIRED', async () => {
    const setup = leagueWithTwoTeams();

    await expect(setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.world.addUser().id,
      email: 'pat@example.com',
    })).rejects.toMatchObject({ code: 'LEAGUE_MEMBERSHIP_REQUIRED' });
  });

  it('refuses a member whose own team membership has ended with SQUAD_OWNER_REQUIRED', async () => {
    const setup = leagueWithTwoTeams();
    const ownerSquadMembership = expectDefined(setup.world.squadMembershipOf(setup.league.id, setup.owner.id));
    setup.world.tables.squadMemberships.patch(ownerSquadMembership.id, { status: SquadMembershipStatus.INACTIVE });

    await expect(setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: 'pat@example.com',
    })).rejects.toMatchObject({ code: 'SQUAD_OWNER_REQUIRED' });
  });

  it('refuses an inactive team with SQUAD_INACTIVE, for a commissioner and a root admin alike', async () => {
    const setup = leagueWithTwoTeams();
    setup.world.tables.squads.patch(setup.ownerSquad.id, { isActive: false });
    const rootAdmin = setup.world.addUser({ isRootAdmin: true });

    for (const [actorUserId, actorIsRootAdmin] of [[setup.commissioner.id, false], [rootAdmin.id, true]] as const) {
      await expect(setup.service.inviteOwner({
        leagueId: setup.league.id,
        squadId: setup.ownerSquad.id,
        actorUserId,
        actorIsRootAdmin,
        email: 'pat@example.com',
      })).rejects.toMatchObject({ code: 'SQUAD_INACTIVE' });
    }
  });

  it('treats a team from another league as not found', async () => {
    const setup = leagueWithTwoTeams();
    const otherLeague = setup.world.addLeague();
    const { squad: foreignSquad } = setup.world.addMember({ league: otherLeague, user: setup.world.addUser() });

    await expect(setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: foreignSquad.id,
      actorUserId: setup.commissioner.id,
      email: 'pat@example.com',
    })).rejects.toBeInstanceOf(SquadOwnerInvitationNotFoundError);
  });
});

describe('SquadOwnerInvitationService — co-owner emails', () => {
  function sent(setup: League3) {
    return setup.outbox.rows.map((row) => ({
      templateKey: row.templateKey,
      to: row.recipientEmail,
      userId: row.recipientUserId,
      leagueId: row.leagueId,
      fromName: row.fromName,
      text: row.textBody ?? '',
    }));
  }

  it('emails an address with no account an invitation from the league naming the inviter, squad and league, with an Accept link to the invite', async () => {
    const setup = leagueWithTwoTeams();

    const invitation = await setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: 'Pat@Example.com',
    });

    const [email, ...others] = sent(setup);
    expect(others).toEqual([]);
    expect(email).toMatchObject({ templateKey: 'SQUAD_OWNER_INVITE', to: 'pat@example.com', userId: undefined, leagueId: setup.league.id, fromName: 'Office Pool' });
    expect(email.text).toContain(`Olive Owner invited you to co-own ${setup.ownerSquad.name} in Office Pool.`);
    expect(email.text).toContain(`Accept invitation: https://app.example.test/team-invite/${invitation.inviteCode}`);
  });

  it('tells an existing account they were added as a co-owner, with a link to the league, and sends no invitation', async () => {
    const setup = leagueWithTwoTeams();
    const pat = setup.world.addUser({ email: 'pat@example.com', firstName: 'Pat', lastName: 'Player' });

    await setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.commissioner.id,
      email: 'pat@example.com',
    });

    const [email, ...others] = sent(setup);
    expect(others).toEqual([]);
    expect(email).toMatchObject({ templateKey: 'SQUAD_OWNER_ADDED', to: 'pat@example.com', userId: pat.id, leagueId: setup.league.id });
    expect(email.text).toContain(`Hi Pat Player,`);
    expect(email.text).toContain(`Casey Commish added you as a co-owner of ${setup.ownerSquad.name} in Office Pool.`);
    expect(email.text).toContain('Open league: https://app.example.test/league/OFFICE');
  });

  it('emails the replacement the same invitation when an owner is replaced', async () => {
    const setup = leagueWithTwoTeams();
    const coOwner = setup.world.addUser({ firstName: 'Cody', lastName: 'CoOwner' });
    setup.world.addMember({ league: setup.league, user: coOwner, squadId: setup.ownerSquad.id });

    await setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      targetUserId: coOwner.id,
      email: 'replacement@example.com',
    });

    expect(sent(setup).map((email) => [email.templateKey, email.to])).toEqual([['SQUAD_OWNER_INVITE', 'replacement@example.com']]);
  });

  it('tells a replacement who already has an account they were added, and sends no invitation', async () => {
    const setup = leagueWithTwoTeams();
    const coOwner = setup.world.addUser({ firstName: 'Cody', lastName: 'CoOwner' });
    setup.world.addMember({ league: setup.league, user: coOwner, squadId: setup.ownerSquad.id });
    const pat = setup.world.addUser({ email: 'pat@example.com' });

    await setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.commissioner.id,
      targetUserId: coOwner.id,
      email: 'pat@example.com',
    });

    expect(sent(setup).map((email) => [email.templateKey, email.userId])).toEqual([['SQUAD_OWNER_ADDED', pat.id]]);
  });

  it('invites the replacement of a squad\'s only owner to own it, not co-own it, without mentioning other owners', async () => {
    const setup = leagueWithTwoTeams();

    await setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.commissioner.id,
      targetUserId: setup.owner.id,
      email: 'replacement@example.com',
    });

    const [email, ...others] = sent(setup);
    expect(others).toEqual([]);
    expect(email.templateKey).toBe('SQUAD_OWNER_INVITE');
    expect(email.text).toContain(`Casey Commish invited you to own ${setup.ownerSquad.name} in Office Pool.`);
    expect(email.text).not.toMatch(/co-own|Co-owners share/);
  });

  it('tells an existing account that replaces a squad\'s only owner that they now own it, without mentioning other owners', async () => {
    const setup = leagueWithTwoTeams();
    setup.world.addUser({ email: 'pat@example.com' });

    await setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.commissioner.id,
      targetUserId: setup.owner.id,
      email: 'pat@example.com',
    });

    const [email, ...others] = sent(setup);
    expect(others).toEqual([]);
    expect(email.templateKey).toBe('SQUAD_OWNER_ADDED');
    expect(email.text).toContain(`Casey Commish made you the owner of ${setup.ownerSquad.name} in Office Pool.`);
    expect(email.text).not.toMatch(/co-owner|other owners/);
  });

  it('keeps the invitation and logs the failure when the email cannot be queued', async () => {
    const setup = leagueWithTwoTeams();
    jest.spyOn(setup.email, 'send').mockRejectedValue(new Error('outbox unavailable'));

    const invitation = await setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: 'pat@example.com',
    });

    expect(invitation.status).toBe(SquadOwnerInvitationStatus.PENDING);
    expect(setup.world.tables.ownerInvitations.where(() => true).map((row) => row.email)).toEqual(['pat@example.com']);
    expect(setup.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'squadOwnerInvitation.email.failed',
        data: expect.objectContaining({ invitationId: invitation.id, error: 'outbox unavailable' }),
      }),
      'Failed to queue the co-owner email',
    );
  });

  it('sends nothing when seating an existing account fails part way', async () => {
    const setup = leagueWithTwoTeams();
    setup.world.addUser({ email: 'pat@example.com' });
    jest.spyOn(setup.world.squadMemberships, 'create').mockRejectedValue(new Error('database unavailable'));

    await expect(setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: 'pat@example.com',
    })).rejects.toThrow('database unavailable');

    expect(sent(setup)).toEqual([]);
  });
});

describe('SquadOwnerInvitationService — replacing an owner', () => {
  function withCoOwner(setup: League3) {
    const coOwner = setup.world.addUser({ firstName: 'Cody', lastName: 'CoOwner' });
    setup.world.addMember({ league: setup.league, user: coOwner, squadId: setup.ownerSquad.id });
    return coOwner;
  }

  it('ends the replaced owner\'s league membership along with their team membership, so no member is left without a team', async () => {
    const setup = leagueWithTwoTeams();
    const coOwner = withCoOwner(setup);

    const invitation = await setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      targetUserId: coOwner.id,
      email: 'replacement@example.com',
    });

    expect(invitation).toMatchObject({
      status: SquadOwnerInvitationStatus.PENDING,
      replacementForUserId: coOwner.id,
    });
    expect(setup.world.squadMembershipOf(setup.league.id, coOwner.id)?.status).toBe(SquadMembershipStatus.INACTIVE);
    expect(setup.world.membershipOf(setup.league.id, coOwner.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([setup.owner.id]);
    expect(setup.world.tables.squads.get(setup.ownerSquad.id)?.isActive).toBe(true);
  });

  it('refuses to replace an owner who is the league\'s last commissioner, changing nothing', async () => {
    const setup = leagueWithTwoTeams();
    setup.world.tables.memberships.patch(
      expectDefined(setup.world.membershipOf(setup.league.id, setup.commissioner.id)).id,
      { role: LeagueRole.MEMBER },
    );
    const coCommissioner = setup.world.addUser();
    setup.world.addMember({ league: setup.league, user: coCommissioner, role: LeagueRole.COMMISSIONER, squadId: setup.ownerSquad.id });

    await expect(setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      targetUserId: coCommissioner.id,
      email: 'replacement@example.com',
    })).rejects.toMatchObject({ code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED' });
    expect(setup.world.squadMembershipOf(setup.league.id, coCommissioner.id)?.status).toBe(SquadMembershipStatus.ACTIVE);
    expect(setup.world.tables.ownerInvitations.where(() => true)).toEqual([]);
  });

  it('hands the replaced owner\'s seat straight to an existing account', async () => {
    const setup = leagueWithTwoTeams();
    const coOwner = withCoOwner(setup);
    const pat = setup.world.addUser({ email: 'pat@example.com' });

    const invitation = await setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.commissioner.id,
      targetUserId: coOwner.id,
      email: 'pat@example.com',
    });

    expect(invitation).toMatchObject({ status: SquadOwnerInvitationStatus.ACCEPTED, acceptedBy: pat.id });
    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([setup.owner.id, pat.id].sort());
  });

  it('keeps a sole owner on an active team, records no invitation, and leaves them in the league when reactivating the team fails part way', async () => {
    const setup = leagueWithTwoTeams();
    const updateSquad = setup.world.squads.update.bind(setup.world.squads);
    jest.spyOn(setup.world.squads, 'update').mockImplementation(async (id, updates) => {
      if (updates.isActive === true) throw new Error('database unavailable');
      return updateSquad(id, updates);
    });

    await expect(setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.commissioner.id,
      targetUserId: setup.owner.id,
      email: 'replacement@example.com',
    })).rejects.toThrow('database unavailable');

    expect(setup.world.tables.squads.get(setup.ownerSquad.id)?.isActive).toBe(true);
    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([setup.owner.id]);
    expect(setup.world.membershipOf(setup.league.id, setup.owner.id)?.status).toBe(LeagueMembershipStatus.ACTIVE);
    expect(setup.world.tables.ownerInvitations.where(() => true)).toEqual([]);
  });

  it('keeps the replaced co-owner on the team and records no invitation when seating the existing account fails part way', async () => {
    const setup = leagueWithTwoTeams();
    const coOwner = withCoOwner(setup);
    setup.world.addUser({ email: 'pat@example.com' });
    jest.spyOn(setup.world.squadMemberships, 'create').mockRejectedValue(new Error('database unavailable'));

    await expect(setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.commissioner.id,
      targetUserId: coOwner.id,
      email: 'pat@example.com',
    })).rejects.toThrow('database unavailable');

    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([setup.owner.id, coOwner.id].sort());
    expect(setup.world.membershipOf(setup.league.id, coOwner.id)?.status).toBe(LeagueMembershipStatus.ACTIVE);
    expect(setup.world.tables.ownerInvitations.where(() => true)).toEqual([]);
  });

  it('refuses an owner replacing themself with SQUAD_OWNER_REPLACE_SELF_FORBIDDEN', async () => {
    const setup = leagueWithTwoTeams();
    withCoOwner(setup);

    await expect(setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      targetUserId: setup.owner.id,
      email: 'pat@example.com',
    })).rejects.toMatchObject({ code: 'SQUAD_OWNER_REPLACE_SELF_FORBIDDEN' });
  });

  it.each([
    ['commissioner', false],
    ['root admin', true],
  ])('lets a %s replace a team\'s only owner, keeping the team active for the replacement', async (_actor, actorIsRootAdmin) => {
    const setup = leagueWithTwoTeams();
    const actorUserId = actorIsRootAdmin ? setup.world.addUser({ isRootAdmin: true }).id : setup.commissioner.id;

    const invitation = await setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId,
      actorIsRootAdmin,
      targetUserId: setup.owner.id,
      email: 'replacement@example.com',
    });

    expect(invitation).toMatchObject({ status: SquadOwnerInvitationStatus.PENDING, replacementForUserId: setup.owner.id });
    expect(setup.world.membershipOf(setup.league.id, setup.owner.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([]);
    expect(setup.world.tables.squads.get(setup.ownerSquad.id)?.isActive).toBe(true);

    const replacement = setup.world.addUser({ email: 'replacement@example.com' });
    await setup.service.acceptInvitation(invitation.inviteCode, replacement.id);
    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([replacement.id]);
  });

  it('refuses a target who does not own the team as not found', async () => {
    const setup = leagueWithTwoTeams();
    withCoOwner(setup);

    await expect(setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      targetUserId: setup.commissioner.id,
      email: 'pat@example.com',
    })).rejects.toBeInstanceOf(SquadOwnerInvitationNotFoundError);
  });

  it('refuses a replacement address with a pending invitation already, keeping the target on the team', async () => {
    const setup = leagueWithTwoTeams();
    const coOwner = withCoOwner(setup);
    seedOwnerInvitation(setup, { email: 'pat@example.com' });

    await expect(setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      targetUserId: coOwner.id,
      email: 'pat@example.com',
    })).rejects.toMatchObject({ code: 'SQUAD_OWNER_INVITATION_DUPLICATE' });
    expect(setup.world.squadMembershipOf(setup.league.id, coOwner.id)?.status).toBe(SquadMembershipStatus.ACTIVE);
  });
});

describe('SquadOwnerInvitationService — listing and revoking', () => {
  it('shows a commissioner every invitation in the league and an owner only their own team\'s', async () => {
    const setup = leagueWithTwoTeams();
    seedOwnerInvitation(setup, { email: 'a@example.com', squadId: setup.ownerSquad.id });
    seedOwnerInvitation(setup, { email: 'b@example.com', squadId: setup.commissionerSquad.id });

    const forCommissioner = await setup.service.listInvitationsForViewer(setup.league.id, setup.commissioner.id, false);
    const forOwner = await setup.service.listInvitationsForViewer(setup.league.id, setup.owner.id, false);

    expect(forCommissioner.map((invitation) => invitation.email).sort()).toEqual(['a@example.com', 'b@example.com']);
    expect(forOwner.map((invitation) => invitation.email)).toEqual(['a@example.com']);
  });

  it('shows a root admin who is not in the league every invitation in it', async () => {
    const setup = leagueWithTwoTeams();
    seedOwnerInvitation(setup);
    const rootAdmin = setup.world.addUser({ isRootAdmin: true });

    await expect(setup.service.listInvitationsForViewer(setup.league.id, rootAdmin.id, true)).resolves.toHaveLength(1);
  });

  it('reports SQUAD_OWNER_INVITATION_TARGET_MISSING when an invitation\'s team has been deleted', async () => {
    const setup = leagueWithTwoTeams();
    const doomed = setup.world.tables.squads.insert({ ...setup.ownerSquad, name: 'Doomed' });
    seedOwnerInvitation(setup, { squadId: doomed.id });
    setup.world.tables.squads.remove(doomed.id);

    await expect(setup.service.listInvitationsForViewer(setup.league.id, setup.commissioner.id, false))
      .rejects.toMatchObject({ code: 'SQUAD_OWNER_INVITATION_TARGET_MISSING' });
  });

  it('revokes a pending invitation and refuses to revoke it again with SQUAD_OWNER_INVITATION_NOT_PENDING', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup);

    await expect(setup.service.revokeInvitation(setup.league.id, invitation.id, setup.owner.id))
      .resolves.toMatchObject({ status: SquadOwnerInvitationStatus.REVOKED });
    await expect(setup.service.revokeInvitation(setup.league.id, invitation.id, setup.owner.id))
      .rejects.toMatchObject({ code: 'SQUAD_OWNER_INVITATION_NOT_PENDING' });
  });

  it('refuses an owner revoking another team\'s invitation, and treats another league\'s invitation as not found', async () => {
    const setup = leagueWithTwoTeams();
    const commissionerTeamInvite = seedOwnerInvitation(setup, { squadId: setup.commissionerSquad.id });
    const otherLeague = setup.world.addLeague();

    await expect(setup.service.revokeInvitation(setup.league.id, commissionerTeamInvite.id, setup.owner.id))
      .rejects.toMatchObject({ code: 'SQUAD_OWNER_SCOPE_FORBIDDEN' });
    await expect(setup.service.revokeInvitation(otherLeague.id, commissionerTeamInvite.id, setup.commissioner.id))
      .rejects.toBeInstanceOf(SquadOwnerInvitationNotFoundError);
    expect(setup.world.tables.ownerInvitations.get(commissionerTeamInvite.id)?.status).toBe(SquadOwnerInvitationStatus.PENDING);
  });
});

describe('SquadOwnerInvitationService — preview, registration and acceptance', () => {
  it('previews the league and team an invitation is for, and that accepting makes you a MEMBER', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup);

    await expect(setup.service.getInvitationPreview(invitation.inviteCode)).resolves.toEqual({
      inviteCode: invitation.inviteCode,
      status: SquadOwnerInvitationStatus.PENDING,
      league: { id: setup.league.id, leagueCode: 'OFFICE', name: 'Office Pool' },
      team: { id: setup.ownerSquad.id, name: setup.ownerSquad.name, iconKey: setup.ownerSquad.iconKey },
      roleAfterAccept: LeagueRole.MEMBER,
    });
  });

  it('refuses to preview an unknown code, or an invitation whose team is gone', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup, { squadId: 'deleted-squad' });

    await expect(setup.service.getInvitationPreview('nope')).rejects.toBeInstanceOf(SquadOwnerInvitationNotFoundError);
    await expect(setup.service.getInvitationPreview(invitation.inviteCode))
      .rejects.toMatchObject({ code: 'SQUAD_OWNER_INVITATION_TARGET_MISSING' });
  });

  it('gives registration the invited address, never one the caller chose', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup, { email: 'invited@example.com' });

    await expect(setup.service.requireInvitationForRegistration(invitation.inviteCode))
      .resolves.toMatchObject({ email: 'invited@example.com' });
  });

  it('sends an invitee who already has an account to sign in with SQUAD_OWNER_INVITATION_ACCOUNT_EXISTS', async () => {
    const setup = leagueWithTwoTeams();
    setup.world.addUser({ email: 'invited@example.com' });
    const invitation = seedOwnerInvitation(setup, { email: 'invited@example.com' });

    await expect(setup.service.requireInvitationForRegistration(invitation.inviteCode))
      .rejects.toMatchObject({ code: 'SQUAD_OWNER_INVITATION_ACCOUNT_EXISTS' });
  });

  it.each([
    [SquadOwnerInvitationStatus.REVOKED, 'SQUAD_OWNER_INVITATION_REVOKED'],
    [SquadOwnerInvitationStatus.ACCEPTED, 'SQUAD_OWNER_INVITATION_ALREADY_ACCEPTED'],
    [SquadOwnerInvitationStatus.EXPIRED, 'SQUAD_OWNER_INVITATION_EXPIRED'],
  ])('refuses a %s invitation at registration and acceptance with %s', async (status, code) => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup, { status });

    await expect(setup.service.requireInvitationForRegistration(invitation.inviteCode)).rejects.toMatchObject({ code });
    await expect(setup.service.acceptInvitation(invitation.inviteCode, setup.world.addUser().id)).rejects.toMatchObject({ code });
  });

  it('marks a past-expiry pending invitation EXPIRED when someone tries to use it', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup, { expiresAt: new Date(Date.now() - 1000) });

    const attempt = setup.service.acceptInvitation(invitation.inviteCode, setup.world.addUser().id);

    await expect(attempt).rejects.toBeInstanceOf(SquadOwnerInvitationOperationError);
    await expect(attempt).rejects.toMatchObject({ code: 'SQUAD_OWNER_INVITATION_EXPIRED', message: 'Invitation has expired' });
    expect(setup.world.tables.ownerInvitations.get(invitation.id)?.status).toBe(SquadOwnerInvitationStatus.EXPIRED);
  });

  it('makes the accepting user an ACTIVE MEMBER and co-owner of the team, and records who accepted', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup);
    const newcomer = setup.world.addUser({ email: 'newcomer@example.com' });

    await expect(setup.service.acceptInvitation(invitation.inviteCode, newcomer.id))
      .resolves.toMatchObject({ status: SquadOwnerInvitationStatus.ACCEPTED, acceptedBy: newcomer.id });
    expect(setup.world.membershipOf(setup.league.id, newcomer.id)).toMatchObject({
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
    });
    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([setup.owner.id, newcomer.id].sort());
  });

  it('leaves the accepting user out of the league and off the team, with the invitation still pending, when marking it accepted fails', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup);
    const newcomer = setup.world.addUser({ email: 'newcomer@example.com' });
    jest.spyOn(setup.world.ownerInvitations, 'update').mockRejectedValue(new Error('database unavailable'));

    await expect(setup.service.acceptInvitation(invitation.inviteCode, newcomer.id))
      .rejects.toThrow('database unavailable');

    expect(setup.world.membershipOf(setup.league.id, newcomer.id)).toBeNull();
    expect(ownersOf(setup.world, setup.ownerSquad.id)).toEqual([setup.owner.id]);
    expect(setup.world.tables.ownerInvitations.get(invitation.id)?.status).toBe(SquadOwnerInvitationStatus.PENDING);
  });

  it('refuses acceptance by someone already in the league, leaving the invitation pending', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup);

    await expect(setup.service.acceptInvitation(invitation.inviteCode, setup.commissioner.id))
      .rejects.toMatchObject({ code: 'SQUAD_OWNER_INVITATION_LEAGUE_MEMBER_CONFLICT' });
    expect(setup.world.tables.ownerInvitations.get(invitation.id)?.status).toBe(SquadOwnerInvitationStatus.PENDING);
  });
});

describe('SquadOwnerInvitationService — who may accept, and inactive leagues', () => {
  it('refuses acceptance by an account whose email is not the invited one, with SQUAD_OWNER_INVITATION_EMAIL_MISMATCH', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup, { email: 'invited@example.com' });
    const forwardedTo = setup.world.addUser({ email: 'someone-else@example.com' });

    await expect(setup.service.acceptInvitation(invitation.inviteCode, forwardedTo.id))
      .rejects.toMatchObject({ code: 'SQUAD_OWNER_INVITATION_EMAIL_MISMATCH' });
    expect(setup.world.membershipOf(setup.league.id, forwardedTo.id)).toBeNull();
    expect(setup.world.tables.ownerInvitations.get(invitation.id)?.status).toBe(SquadOwnerInvitationStatus.PENDING);
  });

  it('accepts when the account email differs from the invited one only in case', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup, { email: 'invited@example.com' });
    const invitee = setup.world.addUser({ email: 'INVITED@example.com' });

    await expect(setup.service.acceptInvitation(invitation.inviteCode, invitee.id))
      .resolves.toMatchObject({ status: SquadOwnerInvitationStatus.ACCEPTED });
  });

  it('refuses inviting or replacing an owner in an inactive league with LEAGUE_INACTIVE, recording no invitation', async () => {
    const setup = leagueWithTwoTeams();
    const coOwner = setup.world.addUser();
    setup.world.addMember({ league: setup.league, user: coOwner, squadId: setup.ownerSquad.id });
    setup.world.tables.leagues.patch(setup.league.id, { isActive: false });

    await expect(setup.service.inviteOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      email: 'pat@example.com',
    })).rejects.toMatchObject({ code: 'LEAGUE_INACTIVE' });
    await expect(setup.service.replaceOwner({
      leagueId: setup.league.id,
      squadId: setup.ownerSquad.id,
      actorUserId: setup.owner.id,
      targetUserId: coOwner.id,
      email: 'pat@example.com',
    })).rejects.toMatchObject({ code: 'LEAGUE_INACTIVE' });
    expect(setup.world.tables.ownerInvitations.where(() => true)).toEqual([]);
    expect(setup.world.squadMembershipOf(setup.league.id, coOwner.id)?.status).toBe(SquadMembershipStatus.ACTIVE);
  });

  it('refuses registering or accepting into an inactive league with LEAGUE_INACTIVE', async () => {
    const setup = leagueWithTwoTeams();
    const invitation = seedOwnerInvitation(setup, { email: 'newcomer@example.com' });
    setup.world.tables.leagues.patch(setup.league.id, { isActive: false });
    const newcomer = setup.world.addUser({ email: 'newcomer@example.com' });

    await expect(setup.service.acceptInvitation(invitation.inviteCode, newcomer.id))
      .rejects.toMatchObject({ code: 'LEAGUE_INACTIVE' });
    setup.world.tables.users.remove(newcomer.id);
    await expect(setup.service.requireInvitationForRegistration(invitation.inviteCode))
      .rejects.toMatchObject({ code: 'LEAGUE_INACTIVE' });
    expect(setup.world.membershipOf(setup.league.id, newcomer.id)).toBeNull();
  });
});
