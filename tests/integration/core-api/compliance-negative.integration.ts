/**
 * Negative-path coverage for compliance ownership checks.
 *
 * This suite is intentionally self-contained:
 * - creates two users
 * - requests a real data export and account deletion for one user
 * - verifies the other user cannot access or cancel those requests
 */
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

describe('Compliance Negative Integration', () => {
  let userOneHeaders: Record<string, string>;
  let userTwoHeaders: Record<string, string>;
  let exportRequestId: string;
  let deletionRequestId: string;

  beforeAll(async () => {
    const userOne = await createTestUser({ displayName: 'Compliance Owner One' });
    const userTwo = await createTestUser({ displayName: 'Compliance Owner Two' });

    userOneHeaders = userOne.headers;
    userTwoHeaders = userTwo.headers;
  });

  it('rejects cross-user export access and deletion cancellation', async () => {
    const exportRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/account/data-export',
      headers: withoutJsonBodyHeaders(userOneHeaders),
    });

    expect(exportRes.statusCode).toBe(202);
    exportRequestId = exportRes.json().requestId;

    const exportForbiddenRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/account/data-export/${exportRequestId}`,
      headers: userTwoHeaders,
    });

    expect(exportForbiddenRes.statusCode).toBe(403);
    expect(exportForbiddenRes.json().message).toContain('another user');

    const deletionRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/account/delete-account',
      headers: userOneHeaders,
      payload: {},
    });

    expect(deletionRes.statusCode).toBe(202);
    deletionRequestId = deletionRes.json().requestId;

    const cancelForbiddenRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/account/delete-account/${deletionRequestId}/cancel`,
      headers: withoutJsonBodyHeaders(userTwoHeaders),
    });

    expect(cancelForbiddenRes.statusCode).toBe(403);
    expect(cancelForbiddenRes.json().message).toContain('another user');
  });
});
