import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
  withoutJsonBodyHeaders,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Consent integration', () => {
  it('records consent and returns consent history with age affirmation', async () => {
    const user = await createTestUser({ displayName: 'Consent Owner' });

    const recordRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/account/consent',
      headers: user.headers,
      payload: {
        consentType: 'terms_of_service',
        granted: true,
        version: '2026-04',
        minimumAgeThreshold: 18,
        ageAffirmed: true,
      },
    });

    expect(recordRes.statusCode).toBe(201);
    expect(recordRes.json()).toEqual({ success: true });

    const historyRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/account/consent',
      headers: withoutJsonBodyHeaders(user.headers),
    });

    expect(historyRes.statusCode).toBe(200);
    expect(historyRes.json()).toMatchObject({
      consents: [
        {
          userId: user.user.id,
          consentType: 'terms_of_service',
          granted: true,
          version: '2026-04',
          minimumAgeThreshold: 18,
          ageAffirmed: true,
        },
      ],
    });
  });
});
