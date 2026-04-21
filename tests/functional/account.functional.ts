import {
  changeAccountPassword,
  createLeague,
  deleteAccount,
  getCurrentUser,
  inactivateAccount,
  loginUser,
  reactivateAccount,
  refreshToken,
  updateAccountPreferences,
  updateAccountProfile,
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
  it('updates profile, preferences, and password through the account SDK surface', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Account Profile User',
    });
    const cookieClient = createCookieSessionClient(user.login.tokens);

    const profileResponse = await updateAccountProfile({
      client: cookieClient,
      body: {
        firstName: 'Updated',
        lastName: 'Person',
      },
    });

    expect(profileResponse.data?.user.firstName).toBe('Updated');
    expect(profileResponse.data?.user.lastName).toBe('Person');

    const preferencesResponse = await updateAccountPreferences({
      client: cookieClient,
      body: {
        timezone: 'America/New_York',
        locale: 'en-US',
        timeFormat: '12H',
        dateFormat: 'MDY',
      },
    });

    expect(preferencesResponse.data?.user.timezone).toBe('America/New_York');
    expect(preferencesResponse.data?.user.locale).toBe('en-US');
    expect(preferencesResponse.data?.user.timeFormat).toBe('12H');
    expect(preferencesResponse.data?.user.dateFormat).toBe('MDY');

    const passwordResponse = await changeAccountPassword({
      client: cookieClient,
      body: {
        currentPassword: user.password,
        newPassword: 'UpdatedPassword123!',
        confirmNewPassword: 'UpdatedPassword123!',
      },
    });

    expect(passwordResponse.data?.success).toBe(true);

    const loginWithOldPassword = await loginUser({
      client: getSdkClient(),
      body: {
        identifier: user.username,
        password: user.password,
      },
    });

    expectFunctionalError(loginWithOldPassword, {
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });

    const loginWithNewPassword = await loginUser({
      client: getSdkClient(),
      body: {
        identifier: user.email,
        password: 'UpdatedPassword123!',
      },
    });

    expect(loginWithNewPassword.data?.user.firstName).toBe('Updated');
    expect(loginWithNewPassword.data?.user.lastName).toBe('Person');
  });

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
        identifier: user.username,
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
        identifier: user.email,
        password: user.password,
      },
    });

    expectFunctionalError(loginAfterDelete, {
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('reactivates an inactive account and blocks permanent delete while league-scoped dependencies remain', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Account Reactivation User',
    });
    const cookieClient = createCookieSessionClient(user.login.tokens);

    const createLeagueResponse = await createLeague({
      client: cookieClient,
      body: {
        name: 'Account Dependency League',
        leagueCode: `ACCT${user.userId.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
      },
    });

    expect(createLeagueResponse.data?.league.id).toBeTruthy();

    const inactivateResponse = await inactivateAccount({
      client: cookieClient,
    });

    expect(inactivateResponse.data?.user.isActive).toBe(false);

    const blockedDeleteResponse = await deleteAccount({
      client: user.client,
      body: {
        email: user.email,
      },
    });

    expectFunctionalError(blockedDeleteResponse, {
      status: 409,
      code: 'ACCOUNT_DELETE_DEPENDENCIES_EXIST',
    });

    const reactivateResponse = await reactivateAccount({
      client: user.client,
    });

    expect(reactivateResponse.data?.user.isActive).toBe(true);

    const refreshedProfile = await getCurrentUser({
      client: user.client,
    });

    expect(refreshedProfile.data?.user.isActive).toBe(true);
  });
});
