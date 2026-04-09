import { getCurrentUser } from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma } from './setup';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Auth', () => {
  it('register -> login -> fetch profile succeeds through the SDK', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Auth Pilot User',
    });

    expect(user.registration.user.email).toBe(user.email);
    expect(user.login.user.id).toBe(user.userId);
    expect(user.registration.tokens.accessToken).toBeTruthy();
    expect(user.login.tokens.refreshToken).toBeTruthy();

    const { data: currentUser } = await getCurrentUser({
      client: user.client,
    });

    expect(currentUser).toBeDefined();
    expect(currentUser?.user.id).toBe(user.userId);
    expect(currentUser?.user.email).toBe(user.email);
    expect(currentUser?.user.displayName).toBe(user.displayName);
  });
});
