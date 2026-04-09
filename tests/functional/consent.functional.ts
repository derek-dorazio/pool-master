import { getConsentHistory, recordConsent } from '@poolmaster/shared/generated/hey-api';
import { buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
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

describe('SDK Functional: Consent', () => {
  it('authenticated user records consent with age affirmation and can read it back', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Consent Pilot User',
    });

    const recordResponse = await recordConsent({
      client: user.client,
      body: {
        consentType: 'terms_of_service',
        granted: true,
        version: '2026-04',
        minimumAgeThreshold: 18,
        ageAffirmed: true,
      },
    });

    expect(recordResponse.data).toBeDefined();
    expect(recordResponse.data?.consent.userId).toBe(user.userId);
    expect(recordResponse.data?.consent.consentType).toBe('terms_of_service');
    expect(recordResponse.data?.consent.granted).toBe(true);
    expect(recordResponse.data?.consent.version).toBe('2026-04');
    expect(recordResponse.data?.consent.minimumAgeThreshold).toBe(18);
    expect(recordResponse.data?.consent.ageAffirmed).toBe(true);

    const historyResponse = await getConsentHistory({
      client: user.client,
    });

    expect(historyResponse.data).toBeDefined();
    expect(historyResponse.data?.consents).toHaveLength(1);
    expect(historyResponse.data?.consents[0]?.userId).toBe(user.userId);
    expect(historyResponse.data?.consents[0]?.version).toBe('2026-04');
  });

  it('unauthenticated consent read/write is rejected with the expected status and error shape', async () => {
    const anonymousClient = getSdkClient();

    const writeResponse = await recordConsent({
      client: anonymousClient,
      body: {
        consentType: 'terms_of_service',
        granted: true,
        version: '2026-04',
        minimumAgeThreshold: 18,
        ageAffirmed: true,
      },
    });
    expectFunctionalError(writeResponse, {
      status: 401,
      code: 'UNAUTHORIZED',
    });

    const readResponse = await getConsentHistory({
      client: anonymousClient,
    });
    expectFunctionalError(readResponse, {
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });
});
