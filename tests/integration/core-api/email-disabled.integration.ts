/**
 * `EMAIL_PROVIDER=disabled` (#442): the setting QA runs with until real delivery is set up (#120).
 * Inviting by email must still create the invitation and succeed, while no email leaves the app.
 * The same invite under the SMTP provider is the control: it shows the sink would have seen a
 * message, so "nothing captured" means nothing was sent rather than that capture is broken.
 */
import type { FastifyInstance } from 'fastify';
import {
  buildCreateLeaguePayload,
  buildTestAppWithMailEnv,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  getSentMail,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import type { LeagueResponse, SendLeagueInvitationsResponse } from '@poolmaster/shared/dto';

let disabledApp: FastifyInstance;

beforeAll(async () => {
  await setupIntegrationTests();
  disabledApp = await buildTestAppWithMailEnv({ EMAIL_PROVIDER: 'disabled' });
});
afterAll(async () => {
  await disabledApp?.close();
  await cleanupTestData();
  await teardownIntegrationTests();
});

async function createLeague(app: FastifyInstance, headers: Record<string, string>): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/leagues',
    headers,
    payload: buildCreateLeaguePayload('Email Setting League'),
  });
  expect(response.statusCode).toBe(201);
  return response.json<LeagueResponse>().league.id;
}

function sentTo(address: string): number {
  return getSentMail().filter((mail) => mail.to.includes(address)).length;
}

describe('league invite by email with email delivery switched off', () => {
  it('creates the pending invitation and returns success without sending any email', async () => {
    const commissioner = await createTestUser();
    const inviteeEmail = `disabled-invitee-${Date.now()}@integration.test`;
    const leagueId = await createLeague(disabledApp, commissioner.headers);
    const sentBefore = getSentMail().length;

    const response = await disabledApp.inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: commissioner.headers,
      payload: { emails: [inviteeEmail] },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<SendLeagueInvitationsResponse>();
    expect(body.sent.map((invitation) => invitation.email)).toEqual([inviteeEmail]);
    const stored = await getPrisma().leagueInvitation.findMany({ where: { leagueId, email: inviteeEmail } });
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe('PENDING');
    expect(getSentMail()).toHaveLength(sentBefore);
  });

  it('sends the same invite through SMTP when email delivery is on', async () => {
    const commissioner = await createTestUser();
    const inviteeEmail = `smtp-invitee-${Date.now()}@integration.test`;
    const leagueId = await createLeague(getApp(), commissioner.headers);

    const response = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: commissioner.headers,
      payload: { emails: [inviteeEmail] },
    });

    expect(response.statusCode).toBe(201);
    expect(sentTo(inviteeEmail)).toBe(1);
  });
});
