/**
 * EMAIL_CONFIG (#450): a root admin switches system email off, or one email off, on
 * /manage/settings. Inviting by email must still create the invitation and succeed while no
 * email leaves the app. The same invite with the defaults is the control: it shows the sink
 * would have seen a message, so "nothing captured" means nothing was sent rather than that
 * capture is broken.
 */
import type { EmailConfig, LeagueResponse, SendLeagueInvitationsResponse, SettingsGroup } from '@poolmaster/shared/dto';
import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
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

async function inviteByEmail(inviteeEmail: string): Promise<{ leagueId: string; statusCode: number; body: SendLeagueInvitationsResponse }> {
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
  return { leagueId, statusCode: response.statusCode, body: response.json<SendLeagueInvitationsResponse>() };
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

  it('with the defaults, sends the same invite through SMTP', async () => {
    const inviteeEmail = `smtp-invitee-${Date.now()}@integration.test`;

    const { statusCode } = await inviteByEmail(inviteeEmail);

    expect(statusCode).toBe(201);
    expect(sentTo(inviteeEmail)).toBe(1);
  });

  it('sends again as soon as an admin switches email back on', async () => {
    await saveEmailConfig((current) => ({ ...current, enabled: false }));
    await saveEmailConfig((current) => ({ ...current, enabled: true }));
    const inviteeEmail = `re-enabled-invitee-${Date.now()}@integration.test`;

    const { statusCode } = await inviteByEmail(inviteeEmail);

    expect(statusCode).toBe(201);
    expect(sentTo(inviteeEmail)).toBe(1);
  });
});
