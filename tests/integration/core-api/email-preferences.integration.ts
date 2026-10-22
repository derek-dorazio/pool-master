/**
 * #844 slice 5 — which categories of email a member gets: GET and PUT
 * /api/v1/users/:userId/email-preferences on their account, and the public one-click
 * POST /api/v1/email/unsubscribe an email's link and List-Unsubscribe header lead to.
 */
import {
  EmailPreferencesResponseSchema,
  EmailUnsubscribeResponseSchema,
  type EmailPreferencesResponse,
} from '@poolmaster/shared/dto';
import { readJwtSecret } from '../../../packages/core-api/src/core/config';
import { PrismaEmailOptOutRepository, PrismaEmailSuppressionRepository } from '../../../packages/core-api/src/adapters';
import { UnsubscribeTokens } from '../../../packages/core-api/src/modules/email';
import { expectMatchesSchema } from '../../support/expect-matches-schema';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

beforeAll(async () => {
  await setupIntegrationTests();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

function turnedOff(body: EmailPreferencesResponse): string[] {
  return body.preferences.filter((preference) => !preference.enabled).map((preference) => preference.category);
}

describe('email preferences on the account', () => {
  it('reads every switch on for a new member, turns one off and back on, and keeps the change', async () => {
    const member = await createTestUser();

    const initial = await getApp().inject({ method: 'GET', url: '/api/v1/users/me/email-preferences', headers: member.headers });
    const off = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/email-preferences',
      headers: member.headers,
      payload: { category: 'RESULTS', enabled: false },
    });
    const reread = await getApp().inject({ method: 'GET', url: '/api/v1/users/me/email-preferences', headers: member.headers });
    const on = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/email-preferences',
      headers: member.headers,
      payload: { category: 'RESULTS', enabled: true },
    });

    expect(initial.statusCode).toBe(200);
    const initialBody = expectMatchesSchema(EmailPreferencesResponseSchema, initial.json());
    expect(initialBody.preferences).toHaveLength(5);
    expect(turnedOff(initialBody)).toEqual([]);
    expect(initialBody.emailSuppression).toBeNull();
    expect(off.statusCode).toBe(200);
    expect(turnedOff(off.json<EmailPreferencesResponse>())).toEqual(['RESULTS']);
    expect(turnedOff(reread.json<EmailPreferencesResponse>())).toEqual(['RESULTS']);
    expect(turnedOff(on.json<EmailPreferencesResponse>())).toEqual([]);
  });

  it('says the address gets no email at all once it bounced for good', async () => {
    const member = await createTestUser();
    await new PrismaEmailSuppressionRepository(getPrisma()).suppress({ email: member.user.email, suppressionReason: 'BOUNCE' });

    const response = await getApp().inject({ method: 'GET', url: '/api/v1/users/me/email-preferences', headers: member.headers });

    expect(response.json<EmailPreferencesResponse>().emailSuppression).toBe('BOUNCE');
  });

  it('refuses another member reading or changing someone else\'s switches with 403, and lets a root admin do both', async () => {
    const member = await createTestUser();
    const other = await createTestUser();
    const admin = await createTestUser({ isRootAdmin: true });
    const url = `/api/v1/users/${member.user.id}/email-preferences`;

    const otherRead = await getApp().inject({ method: 'GET', url, headers: other.headers });
    const otherWrite = await getApp().inject({ method: 'PUT', url, headers: other.headers, payload: { category: 'RECEIPTS', enabled: false } });
    const adminWrite = await getApp().inject({ method: 'PUT', url, headers: admin.headers, payload: { category: 'RECEIPTS', enabled: false } });

    expect(otherRead.statusCode).toBe(403);
    expect(otherWrite.statusCode).toBe(403);
    expect(otherWrite.json<{ error: { code: string } }>().error.code).toBe('USER_WRITE_FORBIDDEN');
    expect(adminWrite.statusCode).toBe(200);
    expect(turnedOff(adminWrite.json<EmailPreferencesResponse>())).toEqual(['RECEIPTS']);
  });

  it('refuses a category that cannot be turned off with 400', async () => {
    const member = await createTestUser();

    const response = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/email-preferences',
      headers: member.headers,
      payload: { category: 'ACCOUNT', enabled: false },
    });

    expect(response.statusCode).toBe(400);
  });

  it('asks for a session', async () => {
    const response = await getApp().inject({ method: 'GET', url: '/api/v1/users/me/email-preferences' });

    expect(response.statusCode).toBe(401);
  });
});

describe('one-click unsubscribe', () => {
  const tokens = () => new UnsubscribeTokens(readJwtSecret());

  it('turns the category off for the user the link names, without a session, from a mail app\'s one-click form post', async () => {
    const member = await createTestUser();
    const token = tokens().issue({ userId: member.user.id, category: 'LIVE_STANDINGS' });

    const response = await getApp().inject({
      method: 'POST',
      url: `/api/v1/email/unsubscribe?token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });

    expect(response.statusCode).toBe(200);
    expect(expectMatchesSchema(EmailUnsubscribeResponseSchema, response.json())).toEqual({ category: 'LIVE_STANDINGS' });
    await expect(new PrismaEmailOptOutRepository(getPrisma()).isOptedOut(member.user.id, 'LIVE_STANDINGS')).resolves.toBe(true);
  });

  it('turns the category off from the "Stop these emails" page\'s post with no body, and repeating it changes nothing', async () => {
    const member = await createTestUser();
    const url = `/api/v1/email/unsubscribe?token=${encodeURIComponent(tokens().issue({ userId: member.user.id, category: 'RECEIPTS' }))}`;

    const first = await getApp().inject({ method: 'POST', url });
    const again = await getApp().inject({ method: 'POST', url });

    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    await expect(new PrismaEmailOptOutRepository(getPrisma()).findByUser(member.user.id)).resolves.toEqual(['RECEIPTS']);
  });

  it('refuses a link this app did not issue with 400 EMAIL_UNSUBSCRIBE_LINK_INVALID and changes nothing', async () => {
    const member = await createTestUser();
    const forged = new UnsubscribeTokens('not-this-apps-secret').issue({ userId: member.user.id, category: 'RECEIPTS' });

    const response = await getApp().inject({ method: 'POST', url: `/api/v1/email/unsubscribe?token=${encodeURIComponent(forged)}` });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('EMAIL_UNSUBSCRIBE_LINK_INVALID');
    await expect(new PrismaEmailOptOutRepository(getPrisma()).findByUser(member.user.id)).resolves.toEqual([]);
  });
});
