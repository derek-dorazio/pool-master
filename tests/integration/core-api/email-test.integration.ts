/**
 * #910 — a root admin's test email from the Email settings: POST /api/v1/platform/email/test
 * sends one fixed email the way every system email goes, and says what happened to it.
 */
import { EmailTestResponseSchema, type EmailConfig, type SettingsGroup } from '@poolmaster/shared/dto';
import { expectMatchesSchema } from '../../support/expect-matches-schema';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getSentMail,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

let rootAdmin: TestUser;

beforeAll(async () => {
  await setupIntegrationTests();
  rootAdmin = await createTestUser({ firstName: 'Testing', lastName: 'Admin', isRootAdmin: true });
});
afterEach(async () => {
  const reset = await getApp().inject({
    method: 'POST',
    url: '/api/v1/platform/settings/EMAIL_CONFIG/reset',
    headers: withoutJsonBodyHeaders(rootAdmin.headers),
  });
  expect(reset.statusCode).toBe(200);
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

function sendTest(headers: Record<string, string>, to: string) {
  return getApp().inject({ method: 'POST', url: '/api/v1/platform/email/test', headers, payload: { to } });
}

function mailTo(address: string) {
  return getSentMail().filter((mail) => mail.to.includes(address));
}

describe('the root admin test email', () => {
  it('sends the test email to the address and reports it SENT, naming the admin who sent it', async () => {
    const address = `email-test-sent-${String(Date.now())}@integration.test`;

    const response = await sendTest(rootAdmin.headers, address);

    expect(response.statusCode).toBe(200);
    expect(expectMatchesSchema(EmailTestResponseSchema, response.json())).toEqual({ status: 'SENT', skipReason: null, error: null });
    const [mail] = mailTo(address);
    expect(mail.subject).toMatch(/^Primetime Commissioner test email \(/);
    expect(mail.text).toContain('Testing Admin sent this test');
  });

  it('reports SKIPPED with EMAIL_DISABLED and sends nothing while "Send system email" is off', async () => {
    const current = (await getApp().inject({
      method: 'GET',
      url: '/api/v1/platform/settings/EMAIL_CONFIG',
      headers: rootAdmin.headers,
    })).json<SettingsGroup & { key: 'EMAIL_CONFIG' }>();
    const off: EmailConfig = { ...current.value, enabled: false };
    const saved = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/platform/settings/EMAIL_CONFIG',
      headers: rootAdmin.headers,
      payload: { key: 'EMAIL_CONFIG', value: off, expectedUpdatedAt: current.updatedAt },
    });
    expect(saved.statusCode).toBe(200);
    const address = `email-test-off-${String(Date.now())}@integration.test`;

    const response = await sendTest(rootAdmin.headers, address);

    expect(response.statusCode).toBe(200);
    expect(expectMatchesSchema(EmailTestResponseSchema, response.json())).toEqual({
      status: 'SKIPPED',
      skipReason: 'EMAIL_DISABLED',
      error: null,
    });
    expect(mailTo(address)).toEqual([]);
  });

  it('refuses a member who is not a root admin with 403 and sends nothing', async () => {
    const member = await createTestUser();
    const address = `email-test-member-${String(Date.now())}@integration.test`;

    const response = await sendTest(member.headers, address);

    expect(response.statusCode).toBe(403);
    expect(mailTo(address)).toEqual([]);
  });

  it('refuses an address that is not an email address with 400', async () => {
    const response = await sendTest(rootAdmin.headers, 'not-an-address');

    expect(response.statusCode).toBe(400);
  });
});
