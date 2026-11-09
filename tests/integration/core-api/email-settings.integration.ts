/**
 * EMAIL_CONFIG (#450): a root admin switches system email off, or one email off, on
 * /manage/settings. Inviting by email must still create the invitation and succeed while no
 * email leaves the app. The same invite with the defaults is the control: it shows the sink
 * would have seen a message, so "nothing captured" means nothing was sent rather than that
 * capture is broken.
 */
import type {
  EmailConfig,
  LeagueResponse,
  ListLeagueInvitationsResponse,
  SendLeagueInvitationsResponse,
  SettingsGroup,
} from '@poolmaster/shared/dto';
import { PrismaEmailMessageRepository } from '../../../packages/core-api/src/adapters';
import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  deliverQueuedIntegrationEmail,
  getApp,
  getAppPrisma,
  getPrisma,
  getSentMail,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

let rootAdmin: TestUser;

beforeAll(async () => {
  await setupIntegrationTests();
  rootAdmin = await createTestUser({ displayName: 'Email Settings Admin', isRootAdmin: true });
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

async function saveEmailConfig(change: (current: EmailConfig) => EmailConfig): Promise<void> {
  const current = (await getApp().inject({
    method: 'GET',
    url: '/api/v1/platform/settings/EMAIL_CONFIG',
    headers: rootAdmin.headers,
  })).json<SettingsGroup & { key: 'EMAIL_CONFIG' }>();
  const saved = await getApp().inject({
    method: 'PUT',
    url: '/api/v1/platform/settings/EMAIL_CONFIG',
    headers: rootAdmin.headers,
    payload: { key: 'EMAIL_CONFIG', value: change(current.value), expectedUpdatedAt: current.updatedAt },
  });
  expect(saved.statusCode).toBe(200);
}

async function inviteByEmail(inviteeEmail: string): Promise<{
  commissioner: TestUser;
  leagueId: string;
  statusCode: number;
  body: SendLeagueInvitationsResponse;
}> {
  const commissioner = await createTestUser();
  const league = await getApp().inject({
    method: 'POST',
    url: '/api/v1/leagues',
    headers: commissioner.headers,
    payload: buildCreateLeaguePayload('Email Setting League'),
  });
  expect(league.statusCode).toBe(201);
  const leagueId = league.json<LeagueResponse>().league.id;

  const response = await getApp().inject({
    method: 'POST',
    url: `/api/v1/leagues/${leagueId}/invitations`,
    headers: commissioner.headers,
    payload: { emails: [inviteeEmail] },
  });
  await deliverQueuedIntegrationEmail();
  return { commissioner, leagueId, statusCode: response.statusCode, body: response.json<SendLeagueInvitationsResponse>() };
}

function sentTo(address: string): number {
  return getSentMail().filter((mail) => mail.to.includes(address)).length;
}

describe('league invite by email under the EMAIL_CONFIG setting', () => {
  it('with email switched off, creates the pending invitation and returns success without sending any email', async () => {
    await saveEmailConfig((current) => ({ ...current, enabled: false }));
    const inviteeEmail = `disabled-invitee-${Date.now()}@integration.test`;
    const sentBefore = getSentMail().length;

    const { leagueId, statusCode, body } = await inviteByEmail(inviteeEmail);

    expect(statusCode).toBe(201);
    expect(body.sent.map((invitation) => invitation.email)).toEqual([inviteeEmail]);
    const stored = await getPrisma().leagueInvitation.findMany({ where: { leagueId, email: inviteeEmail } });
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe('PENDING');
    expect(body.sent[0].emailStatus).toBe('SKIPPED');
    expect(getSentMail()).toHaveLength(sentBefore);
  });

  it('with only the invite email switched off, creates the invitation and sends nothing', async () => {
    await saveEmailConfig((current) => ({
      ...current,
      templates: { ...current.templates, LEAGUE_MEMBER_INVITE: false },
    }));
    const inviteeEmail = `template-off-invitee-${Date.now()}@integration.test`;

    const { statusCode, body } = await inviteByEmail(inviteeEmail);

    expect(statusCode).toBe(201);
    expect(body.sent.map((invitation) => invitation.email)).toEqual([inviteeEmail]);
    expect(sentTo(inviteeEmail)).toBe(0);
  });

  it('with the defaults, queues the same invite, sends it through SMTP, and lists the invite\'s email as sent', async () => {
    const inviteeEmail = `smtp-invitee-${Date.now()}@integration.test`;

    const { commissioner, leagueId, statusCode, body } = await inviteByEmail(inviteeEmail);

    expect(statusCode).toBe(201);
    expect(body.sent[0].emailStatus).toBe('QUEUED');
    expect(sentTo(inviteeEmail)).toBe(1);
    const listed = await getApp().inject({
      method: 'GET',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: commissioner.headers,
    });
    const [invitation] = listed.json<ListLeagueInvitationsResponse>().invitations;
    expect(invitation).toMatchObject({ email: inviteeEmail, emailStatus: 'SENT' });
  });

  it('sends nothing already waiting in the outbox once an admin switches email off, and records it skipped', async () => {
    // Queued as an API-only task queues email: recorded, and left for a sender to find.
    const recipientEmail = `queued-then-off-${Date.now()}@integration.test`;
    const { message } = await new PrismaEmailMessageRepository(getAppPrisma()).record({
      templateKey: 'EVENT_STILL_DRAFT',
      recipientEmail,
      idempotencyKey: `email-settings-test:${recipientEmail}`,
      fromName: 'Primetime Commissioner',
      fromAddress: 'noreply@integration.test',
      status: 'QUEUED',
      subject: 'Still in draft',
      textBody: 'Still in draft',
      htmlBody: '<p>Still in draft</p>',
      dueAt: new Date(),
    });

    try {
      await saveEmailConfig((current) => ({ ...current, enabled: false }));
      await deliverQueuedIntegrationEmail();

      expect(sentTo(recipientEmail)).toBe(0);
      expect(await getPrisma().emailMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'EMAIL_DISABLED',
      });
    } finally {
      await getPrisma().emailMessage.delete({ where: { id: message.id } });
    }
  });

  it('sends again as soon as an admin switches email back on', async () => {
    await saveEmailConfig((current) => ({ ...current, enabled: false }));
    await saveEmailConfig((current) => ({ ...current, enabled: true }));
    const inviteeEmail = `re-enabled-invitee-${Date.now()}@integration.test`;

    const { statusCode } = await inviteByEmail(inviteeEmail);

    expect(statusCode).toBe(201);
    expect(sentTo(inviteeEmail)).toBe(1);
  });

  it('with an allow list, invites anyone but emails only the listed addresses and domains', async () => {
    await saveEmailConfig((current) => ({ ...current, allowedRecipients: ['@allowed.integration.test'] }));
    const allowedEmail = `allowed-invitee-${Date.now()}@allowed.integration.test`;
    const otherEmail = `other-invitee-${Date.now()}@integration.test`;

    const allowed = await inviteByEmail(allowedEmail);
    const other = await inviteByEmail(otherEmail);

    expect([allowed.statusCode, other.statusCode]).toEqual([201, 201]);
    expect(other.body.sent.map((invitation) => invitation.email)).toEqual([otherEmail]);
    expect(sentTo(allowedEmail)).toBe(1);
    expect(sentTo(otherEmail)).toBe(0);
  });
});
