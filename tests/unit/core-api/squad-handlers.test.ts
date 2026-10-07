import { expect } from '@jest/globals';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LeagueMembershipStatus, LeagueRole, type League, type Squad, type User } from '@poolmaster/shared/domain';
import { createSquadHandlers } from '../../../packages/core-api/src/modules/squads/handler';
import { SquadService } from '../../../packages/core-api/src/modules/squads/service';
import { inMemoryLeagueWorld, type InMemoryLeagueWorld } from '../../support/in-memory-league-world';
import { asFastifyReply, asFastifyRequest } from '../../support/fastify-doubles';
import { asPrismaClient } from '../../support/prisma-double';
import { fakeLogger } from '../../support/fake-logger';

/**
 * The team route handlers: what HTTP status and body each service outcome becomes. They run on
 * a real `SquadService` over the in-memory league world, so a 201 means a team really was
 * stored and a 400 carries the service's own error code.
 */

interface Setup {
  world: InMemoryLeagueWorld;
  league: League;
  commissioner: User;
  owner: User;
  ownerSquad: Squad;
  handlers: ReturnType<typeof createSquadHandlers>;
}

function setup(): Setup {
  const world = inMemoryLeagueWorld();
  const league = world.addLeague();
  const commissioner = world.addUser({ firstName: 'Casey', lastName: 'Commish' });
  const owner = world.addUser({ firstName: 'Olive', lastName: 'Owner' });
  world.addMember({ league, user: commissioner, role: LeagueRole.COMMISSIONER });
  const { squad: ownerSquad } = world.addMember({ league, user: owner });
  const service = new SquadService(world.squads, world.squadMemberships, world.memberships, world.users, asPrismaClient({}));
  return { world, league, commissioner, owner, ownerSquad, handlers: createSquadHandlers(service) };
}

function replyDouble() {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    code: jest.fn(function code(this: { statusCode: number }, status: number) {
      this.statusCode = status;
      return this;
    }),
    status: jest.fn(function status(this: { statusCode: number }, status: number) {
      this.statusCode = status;
      return this;
    }),
    send: jest.fn(function send(this: { body: unknown }, body: unknown) {
      this.body = body;
      return this;
    }),
  };
  return reply;
}

function requestAs<R extends FastifyRequest>(user: User | null, fields: Partial<R>): R {
  return asFastifyRequest<R>({
    ...fields,
    authUser: user ? { userId: user.id, email: user.email, isRootAdmin: user.isRootAdmin === true } : undefined,
    log: fakeLogger(),
  } as Partial<R>);
}

type Handler = (request: never, reply: FastifyReply) => Promise<unknown>;

async function call(handler: Handler, request: FastifyRequest) {
  const reply = replyDouble();
  await handler(request as never, asFastifyReply(reply as unknown as Partial<FastifyReply>));
  return reply;
}

describe('Team route handlers', () => {
  it('lists a league\'s teams for a member with 200', async () => {
    const { league, owner, handlers } = setup();

    const reply = await call(handlers.listSquads, requestAs(owner, { params: { id: league.id } }));

    expect(reply.statusCode).toBe(200);
    expect((reply.body as { squads: unknown[] }).squads).toHaveLength(2);
  });

  it('answers 400 with the service\'s code when a non-member lists a league\'s teams', async () => {
    const { world, league, handlers } = setup();

    const reply = await call(handlers.listSquads, requestAs(world.addUser(), { params: { id: league.id } }));

    expect(reply.statusCode).toBe(400);
    expect(reply.body).toMatchObject({ error: { code: 'LEAGUE_MEMBERSHIP_REQUIRED' } });
  });

  it('answers 404 SQUAD_NOT_FOUND for a team that is not in the league', async () => {
    const { league, owner, handlers } = setup();

    const reply = await call(handlers.getSquad, requestAs(owner, { params: { id: league.id, squadId: 'no-such-team' } }));

    expect(reply.statusCode).toBe(404);
    expect(reply.body).toMatchObject({ error: { code: 'SQUAD_NOT_FOUND' } });
  });

  it('reads one team with 200', async () => {
    const { league, owner, ownerSquad, handlers } = setup();

    const reply = await call(handlers.getSquad, requestAs(owner, { params: { id: league.id, squadId: ownerSquad.id } }));

    expect(reply.statusCode).toBe(200);
    expect(reply.body).toMatchObject({ squad: { id: ownerSquad.id } });
  });

  it('creates a team for a member with no team and answers 201', async () => {
    const { world, league, handlers } = setup();
    const newcomer = world.addUser();
    world.tables.memberships.insert({
      leagueId: league.id,
      userId: newcomer.id,
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });

    const reply = await call(
      handlers.createSquad,
      requestAs(newcomer, { params: { id: league.id }, body: { name: 'Fresh Squad' } }),
    );

    expect(reply.statusCode).toBe(201);
    expect(world.tables.squads.where((squad) => squad.name === 'Fresh Squad')).toHaveLength(1);
  });

  it('answers 400 SQUAD_MEMBERSHIP_CONFLICT when a member who owns a team tries to create another', async () => {
    const { league, owner, handlers } = setup();

    const reply = await call(handlers.createSquad, requestAs(owner, { params: { id: league.id }, body: {} }));

    expect(reply.statusCode).toBe(400);
    expect(reply.body).toMatchObject({ error: { code: 'SQUAD_MEMBERSHIP_CONFLICT' } });
  });

  it('renames a team with 200 and answers 400 SQUAD_NAME_TAKEN when the name is another team\'s', async () => {
    const { world, league, owner, ownerSquad, commissioner, handlers } = setup();
    const commissionerTeam = world.squadMembershipOf(league.id, commissioner.id)!;
    const takenName = world.tables.squads.get(commissionerTeam.squadId)!.name;

    const renamed = await call(
      handlers.updateSquad,
      requestAs(owner, { params: { id: league.id, squadId: ownerSquad.id }, body: { name: 'Par Patrol' } }),
    );
    const clash = await call(
      handlers.updateSquad,
      requestAs(owner, { params: { id: league.id, squadId: ownerSquad.id }, body: { name: takenName } }),
    );

    expect(renamed.statusCode).toBe(200);
    expect(clash.statusCode).toBe(400);
    expect(clash.body).toMatchObject({ error: { code: 'SQUAD_NAME_TAKEN' } });
    expect(world.tables.squads.get(ownerSquad.id)?.name).toBe('Par Patrol');
  });

  it('inactivates a team for the commissioner with 200', async () => {
    const { league, commissioner, ownerSquad, handlers } = setup();

    const reply = await call(
      handlers.inactivateSquad,
      requestAs(commissioner, { params: { id: league.id, squadId: ownerSquad.id } }),
    );

    expect(reply.statusCode).toBe(200);
    expect(reply.body).toMatchObject({ squad: { id: ownerSquad.id, isActive: false } });
  });

  it('answers 400 SQUAD_DELETE_REQUIRES_INACTIVE when deleting an active team', async () => {
    const { world, league, ownerSquad, handlers } = setup();
    const admin = world.addUser({ isRootAdmin: true });

    const reply = await call(
      handlers.deleteSquad,
      requestAs(admin, { params: { id: league.id, squadId: ownerSquad.id } }),
    );

    expect(reply.statusCode).toBe(400);
    expect(reply.body).toMatchObject({ error: { code: 'SQUAD_DELETE_REQUIRES_INACTIVE' } });
  });

  it('adds a co-owner with 201 and removes them again with 200', async () => {
    const { world, league, owner, ownerSquad, handlers } = setup();
    const coOwner = world.addUser();
    world.tables.memberships.insert({
      leagueId: league.id,
      userId: coOwner.id,
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
      joinedAt: new Date(),
    });

    const added = await call(
      handlers.addOwner,
      requestAs(owner, { params: { id: league.id, squadId: ownerSquad.id }, body: { userId: coOwner.id } }),
    );
    const removed = await call(
      handlers.removeOwner,
      requestAs(owner, { params: { id: league.id, squadId: ownerSquad.id, userId: coOwner.id } }),
    );

    expect(added.statusCode).toBe(201);
    expect(removed.statusCode).toBe(200);
    expect(world.membershipOf(league.id, coOwner.id)?.status).toBe(LeagueMembershipStatus.INACTIVE);
  });

  it('answers 400 SQUAD_OWNER_REMOVE_REQUIRES_MULTIPLE_OWNERS when removing a team\'s only owner', async () => {
    const { league, commissioner, owner, ownerSquad, handlers } = setup();

    const reply = await call(
      handlers.removeOwner,
      requestAs(commissioner, { params: { id: league.id, squadId: ownerSquad.id, userId: owner.id } }),
    );

    expect(reply.statusCode).toBe(400);
    expect(reply.body).toMatchObject({ error: { code: 'SQUAD_OWNER_REMOVE_REQUIRES_MULTIPLE_OWNERS' } });
  });

  it('lets an unauthenticated request\'s 401 reach the global error handler instead of answering it as a team error', async () => {
    const { league, handlers } = setup();

    await expect(call(handlers.listSquads, requestAs(null, { params: { id: league.id } }))).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_SESSION_REQUIRED',
    });
  });
});
