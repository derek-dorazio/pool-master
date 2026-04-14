import {
  deleteAccount,
  getCurrentUser,
  inactivateAccount,
  loginUser,
  refreshToken,
} from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  createCookieSessionClient,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getSdkClient,
} from './setup';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Account Lifecycle', () => {
  it('inactivates an account, blocks new auth, and permanently deletes it with exact email confirmation', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Account Lifecycle User',
    });
    const cookieClient = createCookieSessionClient(user.login.tokens);

    const inactivateResponse = await inactivateAccount({
      client: cookieClient,
    });

    expect(inactivateResponse.data?.user.id).toBe(user.userId);
    expect(inactivateResponse.data?.user.isActive).toBe(false);

    const currentUserResponse = await getCurrentUser({
      client: user.client,
    });

    expect(currentUserResponse.data?.user.isActive).toBe(false);

    const loginResponse = await loginUser({
      client: getSdkClient(),
      body: {
        email: user.email,
        password: user.password,
      },
    });

    expectFunctionalError(loginResponse, {
      status: 403,
      code: 'ACCOUNT_INACTIVE',
    });

    const refreshResponse = await refreshToken({
      client: cookieClient,
    });

    expectFunctionalError(refreshResponse, {
      status: 401,
      code: 'INVALID_REFRESH_TOKEN',
    });

    const wrongDeleteResponse = await deleteAccount({
      client: user.client,
      body: {
        email: 'wrong@example.com',
      },
    });

    expectFunctionalError(wrongDeleteResponse, {
      status: 400,
      code: 'ACCOUNT_DELETE_CONFIRMATION_MISMATCH',
    });

    const deleteResponse = await deleteAccount({
      client: user.client,
      body: {
        email: user.email,
      },
    });

    expect(deleteResponse.data?.success).toBe(true);

    const meAfterDelete = await getCurrentUser({
      client: user.client,
    });

    expectFunctionalError(meAfterDelete, {
      status: 404,
      code: 'USER_NOT_FOUND',
    });

    const loginAfterDelete = await loginUser({
      client: getSdkClient(),
      body: {
        email: user.email,
        password: user.password,
      },
    });

    expectFunctionalError(loginAfterDelete, {
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });
});
