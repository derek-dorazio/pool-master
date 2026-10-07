/**
 * The last-root-admin guard, against a stateful user table.
 *
 * The guard exists so the platform is never left with nobody able to administer it. An
 * inactive root admin cannot do that: sign-in and refresh both refuse an inactive account. So
 * "another root admin exists" has to mean another ACTIVE one, or two admins can switch each
 * other off in turn and lock everyone out.
 *
 * The fake below counts exactly what the Prisma adapter's count query counts, and the
 * service's own writes land in it, so each case reads as a sequence of real operations.
 */
import { expect } from '@jest/globals';
import type { UserRepository } from '@poolmaster/shared/db';
import type { User } from '@poolmaster/shared/domain';
import { UserService } from '../../../packages/core-api/src/modules/users/user-service';
import { UserOperationError } from '../../../packages/core-api/src/modules/users/user-errors';
import { asPrismaClient } from '../../support/prisma-double';
import { fakeUserRepo } from '../../support/repo-fakes';

function buildUser(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    email: `${id}@example.com`,
    username: id,
    firstName: 'Root',
    lastName: 'Admin',
    isActive: true,
    isRootAdmin: true,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createUserWorld(seed: User[]) {
  const rows = new Map(seed.map((user) => [user.id, { ...user }]));

  const users: UserRepository = fakeUserRepo({
    findById: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
    countRootAdmins: async () =>
      [...rows.values()].filter((user) => user.isRootAdmin === true).length,
    update: async (id, updates) => {
      const next = { ...rows.get(id)!, ...updates } as User;
      rows.set(id, next);
      return { ...next };
    },
  });

  const tx = {
    user: {
      update: async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
        rows.set(where.id, { ...rows.get(where.id)!, ...data });
      },
      delete: async ({ where }: { where: { id: string } }) => {
        rows.delete(where.id);
      },
    },
    refreshToken: {
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
    },
    leagueInvitation: { deleteMany: async () => ({ count: 0 }) },
  };
  const prisma = {
    leagueMembership: { count: async () => 0 },
    squadMembership: { count: async () => 0 },
    squad: { count: async () => 0 },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  };

  return {
    service: new UserService(users, asPrismaClient(prisma)),
    row: (id: string) => rows.get(id),
  };
}

const actorFor = (id: string) => ({ userId: id, isRootAdmin: true });

async function rejection(work: Promise<unknown>): Promise<UserOperationError> {
  const error = await work.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(UserOperationError);
  return error as UserOperationError;
}

describe('last-root-admin guard counts only active root admins', () => {
  it('refuses to let the only active root admin disable themselves when the other root admin is inactive', async () => {
    const world = createUserWorld([
      buildUser('admin-active'),
      buildUser('admin-inactive', { isActive: false }),
    ]);

    const error = await rejection(world.service.disableUser(actorFor('admin-active'), 'admin-active'));

    expect(error.code).toBe('ACCOUNT_LAST_ROOT_ADMIN');
    expect(world.row('admin-active')?.isActive).toBe(true);
  });

  it('refuses the second of two root admins switching each other off, leaving one active', async () => {
    const world = createUserWorld([buildUser('admin-a'), buildUser('admin-b')]);

    await world.service.disableUser(actorFor('admin-a'), 'admin-b');
    const error = await rejection(world.service.disableUser(actorFor('admin-a'), 'admin-a'));

    expect(error.code).toBe('ACCOUNT_LAST_ROOT_ADMIN');
    expect(world.row('admin-a')?.isActive).toBe(true);
    expect(world.row('admin-b')?.isActive).toBe(false);
  });

  it('refuses to demote the only active root admin when the other root admin is inactive', async () => {
    const world = createUserWorld([
      buildUser('admin-active'),
      buildUser('admin-inactive', { isActive: false }),
    ]);

    const error = await rejection(world.service.setRootAdmin(actorFor('admin-active'), 'admin-active', false));

    expect(error.code).toBe('LAST_ROOT_ADMIN');
    expect(world.row('admin-active')?.isRootAdmin).toBe(true);
  });

  it('lets an active root admin delete an inactive root admin, because an active one remains', async () => {
    const world = createUserWorld([
      buildUser('admin-active'),
      buildUser('admin-inactive', { isActive: false }),
    ]);

    await world.service.deleteUser(actorFor('admin-active'), 'admin-inactive', 'admin-inactive@example.com');

    expect(world.row('admin-inactive')).toBeUndefined();
  });

  it('refuses to delete an inactive root admin when no active root admin would remain', async () => {
    const world = createUserWorld([buildUser('admin-inactive', { isActive: false })]);

    const error = await rejection(
      world.service.deleteUser(actorFor('admin-inactive'), 'admin-inactive', 'admin-inactive@example.com'),
    );

    expect(error.code).toBe('ACCOUNT_LAST_ROOT_ADMIN');
    expect(world.row('admin-inactive')).toBeDefined();
  });

  it('lets an inactive root admin be demoted while an active root admin remains', async () => {
    const world = createUserWorld([
      buildUser('admin-active'),
      buildUser('admin-inactive', { isActive: false }),
    ]);

    await world.service.setRootAdmin(actorFor('admin-active'), 'admin-inactive', false);

    expect(world.row('admin-inactive')?.isRootAdmin).toBe(false);
  });
});
