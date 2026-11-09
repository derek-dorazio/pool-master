/**
 * The team (squad) route handlers (#1482), called with a stand-in squad service: what each
 * operation passes on and answers with, the status a missing team or a refused change is sent
 * with, and that any other error, such as an unauthenticated request's 401, reaches the global
 * error handler unchanged.
 */
import { expect } from '@jest/globals';
import { SquadNotFoundError, SquadOperationError } from '../../../packages/core-api/src/modules/squads/errors';
import { createSquadHandlers } from '../../../packages/core-api/src/modules/squads/handler';
import type { SquadService } from '../../../packages/core-api/src/modules/squads/service';
import type { AuthUser } from '../../../packages/core-api/src/plugins/auth-guard';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';

const boom = new Error('database down');
const squad = { id: 'squad-1', leagueId: 'league-1', name: 'The Squad' };
const membership = { id: 'sm-1', squadId: 'squad-1', userId: 'user-2' };
const me = authUser('user-1');
const admin = authUser('admin', { isRootAdmin: true });

function squadService(overrides: Record<string, unknown> = {}) {
  return {
    listSquads: jest.fn((..._args: unknown[]) => Promise.resolve([squad])),
    getSquad: jest.fn((..._args: unknown[]) => Promise.resolve(squad)),
    createSquad: jest.fn((..._args: unknown[]) => Promise.resolve(squad)),
    updateSquad: jest.fn((..._args: unknown[]) => Promise.resolve(squad)),
    inactivateSquad: jest.fn((..._args: unknown[]) => Promise.resolve(squad)),
    deleteInactiveSquad: jest.fn((..._args: unknown[]) => Promise.resolve()),
    addOwner: jest.fn((..._args: unknown[]) => Promise.resolve(membership)),
    removeOwner: jest.fn((..._args: unknown[]) => Promise.resolve(membership)),
    ...overrides,
  };
}
const handlersOver = (fake = squadService()) => createSquadHandlers(fake as unknown as SquadService);

const params = { id: 'league-1', squadId: 'squad-1' };
const operations = {
  listSquads: { method: 'listSquads', request: (user: AuthUser | null = me) => stubRequest({ params: { id: 'league-1' }, authUser: user ?? undefined }) },
  getSquad: { method: 'getSquad', request: (user: AuthUser | null = me) => stubRequest({ params, authUser: user ?? undefined }) },
  createSquad: { method: 'createSquad', request: (user: AuthUser | null = me) => stubRequest({ params: { id: 'league-1' }, body: { name: ' Mine ', iconKey: 'EAGLE' }, authUser: user ?? undefined }) },
  updateSquad: { method: 'updateSquad', request: (user: AuthUser | null = me) => stubRequest({ params, body: { name: 'Renamed' }, authUser: user ?? undefined }) },
  inactivateSquad: { method: 'inactivateSquad', request: (user: AuthUser | null = me) => stubRequest({ params, authUser: user ?? undefined }) },
  deleteSquad: { method: 'deleteInactiveSquad', request: (user: AuthUser | null = admin) => stubRequest({ params, authUser: user ?? undefined }) },
  addOwner: { method: 'addOwner', request: (user: AuthUser | null = me) => stubRequest({ params, body: { userId: 'user-2' }, authUser: user ?? undefined }) },
  removeOwner: { method: 'removeOwner', request: (user: AuthUser | null = me) => stubRequest({ params: { ...params, userId: 'user-2' }, authUser: user ?? undefined }) },
} as const;
type Operation = keyof typeof operations;
const names = Object.keys(operations) as Operation[];

describe('team route handlers: success', () => {
  it('lists a league\'s teams and reads one, as the caller', async () => {
    const fake = squadService();
    const handlers = handlersOver(fake);

    const list = await callHandler(handlers.listSquads, operations.listSquads.request());
    const one = await callHandler(handlers.getSquad, stubRequest({ params, authUser: admin, contextLogger: false }));

    expect(fake.listSquads).toHaveBeenCalledWith('league-1', 'user-1', false);
    expect(fake.getSquad).toHaveBeenCalledWith('league-1', 'squad-1', 'admin', true);
    expect(list).toMatchObject({ statusCode: 200, body: { squads: [squad] } });
    expect(one.body).toEqual({ squad });
  });

  it('creates a team with 201 from the body\'s name and icon, and one with neither', async () => {
    const fake = squadService();
    const handlers = handlersOver(fake);

    const created = await callHandler(handlers.createSquad, operations.createSquad.request());
    await callHandler(handlers.createSquad, stubRequest({ params: { id: 'league-1' }, body: {}, authUser: me, contextLogger: false }));

    expect(created).toMatchObject({ statusCode: 201, body: { squad } });
    expect(fake.createSquad.mock.calls).toEqual([
      ['league-1', 'user-1', { name: ' Mine ', iconKey: 'EAGLE' }],
      ['league-1', 'user-1', { name: undefined, iconKey: undefined }],
    ]);
  });

  it('updates, inactivates and deletes a team, answering with the team or success', async () => {
    const fake = squadService();
    const handlers = handlersOver(fake);

    const updated = await callHandler(handlers.updateSquad, stubRequest({ params, body: { iconKey: 'EAGLE' }, authUser: admin, contextLogger: false }));
    const inactivated = await callHandler(handlers.inactivateSquad, stubRequest({ params, authUser: me, contextLogger: false }));
    const deleted = await callHandler(handlers.deleteSquad, stubRequest({ params, authUser: admin, contextLogger: false }));

    expect(fake.updateSquad).toHaveBeenCalledWith('league-1', 'squad-1', 'admin', { name: undefined, iconKey: 'EAGLE' }, true);
    expect(fake.inactivateSquad).toHaveBeenCalledWith('league-1', 'squad-1', 'user-1', false);
    expect(fake.deleteInactiveSquad).toHaveBeenCalledWith('league-1', 'squad-1', 'admin');
    expect(updated.body).toEqual({ squad });
    expect(inactivated.body).toEqual({ squad });
    expect(deleted.body).toEqual({ success: true });
  });

  it('adds a co-owner with 201 and removes one with 200, answering with the membership', async () => {
    const fake = squadService();
    const handlers = handlersOver(fake);

    const added = await callHandler(handlers.addOwner, stubRequest({ params, body: { userId: 'user-2' }, authUser: admin, contextLogger: false }));
    const removed = await callHandler(handlers.removeOwner, stubRequest({ params: { ...params, userId: 'user-2' }, authUser: me, contextLogger: false }));

    expect(fake.addOwner).toHaveBeenCalledWith('league-1', 'squad-1', 'admin', 'user-2', true);
    expect(fake.removeOwner).toHaveBeenCalledWith('league-1', 'squad-1', 'user-1', 'user-2', false);
    expect(added).toMatchObject({ statusCode: 201, body: { membership } });
    expect(removed).toMatchObject({ statusCode: 200, body: { membership } });
  });
});

describe('team route handlers: refusals', () => {
  it.each(names)('%s answers a missing team with 404 SQUAD_NOT_FOUND', async (handler) => {
    const { method, request } = operations[handler];
    const handlers = handlersOver(squadService({ [method]: () => Promise.reject(new SquadNotFoundError('Squad not found')) }));

    expect(await callHandler(handlers[handler], request())).toMatchObject({ statusCode: 404, body: { error: { code: 'SQUAD_NOT_FOUND' } } });
  });

  it.each(names)('%s answers a refused change with 400 and the service\'s code', async (handler) => {
    const { method, request } = operations[handler];
    const handlers = handlersOver(squadService({ [method]: () => Promise.reject(new SquadOperationError('Not allowed', 'SQUAD_MEMBERSHIP_CONFLICT')) }));

    expect(await callHandler(handlers[handler], request())).toMatchObject({ statusCode: 400, body: { error: { code: 'SQUAD_MEMBERSHIP_CONFLICT' } } });
  });

  it.each(names)('%s passes an unexpected failure on to the global error handler', async (handler) => {
    const { method, request } = operations[handler];
    const handlers = handlersOver(squadService({ [method]: () => Promise.reject(boom) }));

    await expect(callHandler(handlers[handler], request())).rejects.toBe(boom);
  });

  it.each(names)('%s lets an unauthenticated request\'s 401 reach the global error handler, calling no service', async (handler) => {
    const fake = squadService();
    const { method, request } = operations[handler];

    await expect(callHandler(handlersOver(fake)[handler], request(null))).rejects.toMatchObject({ statusCode: 401, code: 'AUTH_SESSION_REQUIRED' });
    expect(fake[method]).not.toHaveBeenCalled();
  });
});
