import {
  changeUserPassword,
  createLeague,
  deleteUser,
  getUser,
  disableUser,
  loginUser,
  enableUser,
  refreshToken,
  updateUserPreferences,
  updateUserProfile,
  updateUserUsername,
} from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  createFunctionalEmail,
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
    const updatedEmail = createFunctionalEmail('updated-account-profile');
    const updatedUsername = `updated-account-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const profileResponse = await updateUserProfile({
      client: cookieClient,
      path: { userId: 'me' },
      body: {
        email: updatedEmail,
        firstName: 'Updated',
        lastName: 'Person',
      },
    });

    expect(profileResponse.data?.user.email).toBe(updatedEmail);
    expect(profileResponse.data?.user.firstName).toBe('Updated');
    expect(profileResponse.data?.user.lastName).toBe('Person');

    const usernameResponse = await updateUserUsername({
      client: cookieClient,
      path: { userId: 'me' },
      body: {
        username: updatedUsername,
      },
    });

    expect(usernameResponse.data?.user.username).toBe(updatedUsername);

    const preferencesResponse = await updateUserPreferences({
      client: cookieClient,
      path: { userId: 'me' },
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

    const passwordResponse = await changeUserPassword({
      client: cookieClient,
      path: { userId: 'me' },
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
        identifier: updatedUsername,
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
        identifier: updatedUsername,
        password: 'UpdatedPassword123!',
      },
    });

    expect(loginWithNewPassword.data?.user.firstName).toBe('Updated');
    expect(loginWithNewPassword.data?.user.lastName).toBe('Person');
  });

  it('inactivates an account, still signs it in as inactive, and permanently deletes it with exact email confirmation', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Account Lifecycle User',
    });
    const cookieClient = createCookieSessionClient(user.login.tokens);

    const inactivateResponse = await disableUser({
      client: cookieClient,
      path: { userId: 'me' },
    });

    expect(inactivateResponse.data?.user.id).toBe(user.userId);
    expect(inactivateResponse.data?.user.isActive).toBe(false);

    const currentUserResponse = await getUser({
      client: user.client,
      path: { userId: 'me' },
    });

    expect(currentUserResponse.data?.user.isActive).toBe(false);

    // A9: an inactive account still signs in, because reactivating or deleting it needs a
    // session. The session that inactivated it is kept too.
    const loginResponse = await loginUser({
      client: getSdkClient(),
      body: {
        identifier: user.username,
        password: user.password,
      },
    });

    expect(loginResponse.data?.user.isActive).toBe(false);

    const refreshResponse = await refreshToken({
      client: cookieClient,
    });

    expect(refreshResponse.data?.accessToken).toBeTruthy();

    const wrongDeleteResponse = await deleteUser({
      client: user.client,
      path: { userId: 'me' },
      body: {
        email: 'wrong@example.com',
      },
    });

    expectFunctionalError(wrongDeleteResponse, {
      status: 400,
      code: 'ACCOUNT_DELETE_CONFIRMATION_MISMATCH',
    });

    const deleteResponse = await deleteUser({
      client: user.client,
      path: { userId: 'me' },
      body: {
        email: user.email,
      },
    });

    expect(deleteResponse.data?.success).toBe(true);

    const meAfterDelete = await getUser({
      client: user.client,
      path: { userId: 'me' },
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

    const inactivateResponse = await disableUser({
      client: cookieClient,
      path: { userId: 'me' },
    });

    expect(inactivateResponse.data?.user.isActive).toBe(false);

    const blockedDeleteResponse = await deleteUser({
      client: user.client,
      path: { userId: 'me' },
      body: {
        email: user.email,
      },
    });

    expectFunctionalError(blockedDeleteResponse, {
      status: 409,
      code: 'ACCOUNT_DELETE_DEPENDENCIES_EXIST',
    });

    const reactivateResponse = await enableUser({
      client: user.client,
      path: { userId: 'me' },
    });

    expect(reactivateResponse.data?.user.isActive).toBe(true);

    const refreshedProfile = await getUser({
      client: user.client,
      path: { userId: 'me' },
    });

    expect(refreshedProfile.data?.user.isActive).toBe(true);
  });
});
