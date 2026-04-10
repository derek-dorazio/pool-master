import {
  adminGetMigrationRunDetail,
  adminListMigrations,
  adminListUsers,
} from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

async function promoteToRootAdmin(userId: string): Promise<void> {
  await getFunctionalPrisma().user.update({
    where: { id: userId },
    data: { isRootAdmin: true },
  });
}

describe('SDK Functional: Root Admin', () => {
  it('rejects non-root-admin users from root-admin SDK flows', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Denial User',
    });

    const response = await adminListUsers({
      client: user.client,
    });

    expectFunctionalError(response, {
      status: 403,
      code: 'ROOT_ADMIN_ACCESS_REQUIRED',
    });
  });

  it('allows a promoted root-admin user to read root-admin service data', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Service User',
    });
    await promoteToRootAdmin(user.userId);

    const usersResponse = await adminListUsers({
      client: user.client,
    });
    expect(usersResponse.data?.items.some((item) => item.id === user.userId)).toBe(true);

    const migrationsResponse = await adminListMigrations({
      client: user.client,
    });
    expect(migrationsResponse.data?.available.length).toBeGreaterThan(0);
    expect(Array.isArray(migrationsResponse.data?.recentHistory)).toBe(true);
  });

  it('returns stable not-found codes for root-admin migration reads', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Root Admin Migration User',
    });
    await promoteToRootAdmin(user.userId);

    const response = await adminGetMigrationRunDetail({
      client: user.client,
      path: {
        runId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expectFunctionalError(response, {
      status: 404,
      code: 'MIGRATION_RUN_NOT_FOUND',
    });
  });
});
