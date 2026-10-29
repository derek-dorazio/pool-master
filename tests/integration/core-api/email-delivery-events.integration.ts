/**
 * #844 slice 4 — SES delivery events reach core-api from SNS at POST /api/v1/email/ses-events.
 * The route believes only messages signed by SNS (here, the harness's test key) from its own
 * topic; an event moves the email's row forward, and a permanent bounce or a complaint puts the
 * address on email_suppressions, after which the app sends that address nothing.
 */
import {
  ListLeagueInvitationsResponseSchema,
  type LeagueResponse,
  type ResendLeagueInvitationResponse,
  type SendLeagueInvitationsResponse,
  type SnsMessage,
} from '@poolmaster/shared/dto';
import { PrismaEmailMessageRepository, PrismaEmailSuppressionRepository } from '../../../packages/core-api/src/adapters';
import { expectMatchesSchema } from '../../support/expect-matches-schema';
import { complaint, permanentBounce, sesEvent, TEST_TOPIC_ARN } from '../../support/sns-messages';
import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  deliverQueuedIntegrationEmail,
  getApp,
  getConfirmedSnsSubscriptions,
  getPrisma,
  getSnsSigner,
  outsideQueryPlanCheck,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  await setupIntegrationTests();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

/** Posts an SNS message as SNS does: JSON with a text/plain content type, and no session. */
function postSns(message: SnsMessage) {
  return getApp().inject({
    method: 'POST',
    url: '/api/v1/email/ses-events',
    headers: { 'content-type': 'text/plain; charset=UTF-8', 'x-amz-sns-message-type': message.Type },
    payload: JSON.stringify(message),
  });
}

function notification(eventJson: string): SnsMessage {
  return getSnsSigner().sign({ Type: 'Notification', Message: eventJson });
}

/** A commissioner's league with one email invite, its email sent through the SMTP sink. */
async function sentInvite(): Promise<{ commissioner: TestUser; leagueId: string; inviteeEmail: string; providerMessageId: string }> {
  const commissioner = await createTestUser();
  const league = await getApp().inject({
    method: 'POST',
    url: '/api/v1/leagues',
    headers: commissioner.headers,
    payload: buildCreateLeaguePayload('Bounce League'),
  });
  const leagueId = league.json<LeagueResponse>().league.id;
  const inviteeEmail = `bounce-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@integration.test`;
  const sent = await getApp().inject({
    method: 'POST',
    url: `/api/v1/leagues/${leagueId}/invitations`,
    headers: commissioner.headers,
    payload: { emails: [inviteeEmail] },
  });
  expect(sent.json<SendLeagueInvitationsResponse>().sent[0].emailStatus).toBe('QUEUED');
  await deliverQueuedIntegrationEmail();
  const row = await outsideQueryPlanCheck(() => getPrisma().emailMessage.findFirstOrThrow({ where: { recipientEmail: inviteeEmail } }));
  expect(row.providerMessageId).toBeTruthy();
  return { commissioner, leagueId, inviteeEmail, providerMessageId: row.providerMessageId as string };
}

async function listedInvite(commissioner: TestUser, leagueId: string) {
  const listed = await getApp().inject({
    method: 'GET',
    url: `/api/v1/leagues/${leagueId}/invitations`,
    headers: commissioner.headers,
  });
  return expectMatchesSchema(ListLeagueInvitationsResponseSchema, listed.json()).invitations[0];
}

describe('SES delivery events route', () => {
  it('marks an invite\'s email delivered when SNS posts a signed delivery event, and the commissioner sees it', async () => {
    const { commissioner, leagueId, providerMessageId } = await sentInvite();

    const response = await postSns(notification(sesEvent('Delivery', providerMessageId)));

    expect(response.statusCode).toBe(200);
    expect(await listedInvite(commissioner, leagueId)).toMatchObject({ emailStatus: 'DELIVERED', emailSkipReason: null });
  });

  it('on a permanent bounce, marks the invite\'s email bounced, and a resend to that address is skipped as suppressed', async () => {
    const { commissioner, leagueId, inviteeEmail, providerMessageId } = await sentInvite();

    const response = await postSns(notification(permanentBounce(providerMessageId, inviteeEmail.toUpperCase())));

    expect(response.statusCode).toBe(200);
    const invite = await listedInvite(commissioner, leagueId);
    expect(invite.emailStatus).toBe('BOUNCED');
    expect(await getPrisma().emailSuppression.findUnique({ where: { email: inviteeEmail } }))
      .toMatchObject({ suppressionReason: 'BOUNCE' });
    const resent = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations/${invite.id}/resend`,
      headers: withoutJsonBodyHeaders(commissioner.headers),
    });
    expect(resent.json<ResendLeagueInvitationResponse>().invitation)
      .toMatchObject({ emailStatus: 'SKIPPED', emailSkipReason: 'SUPPRESSED' });
    expect(await listedInvite(commissioner, leagueId)).toMatchObject({ emailStatus: 'SKIPPED', emailSkipReason: 'SUPPRESSED' });
  });

  it('on a complaint, marks the email complained and suppresses the address', async () => {
    const { inviteeEmail, providerMessageId } = await sentInvite();

    await postSns(notification(complaint(providerMessageId, inviteeEmail)));

    expect(await getPrisma().emailMessage.findFirst({ where: { providerMessageId } })).toMatchObject({ status: 'COMPLAINED' });
    expect(await getPrisma().emailSuppression.findUnique({ where: { email: inviteeEmail } }))
      .toMatchObject({ suppressionReason: 'COMPLAINT' });
  });

  it('refuses with 403 EMAIL_EVENT_UNVERIFIED a message with a bad signature, from another topic, or from a non-SNS certificate URL, and changes nothing', async () => {
    const { providerMessageId } = await sentInvite();
    const signed = notification(sesEvent('Delivery', providerMessageId));

    const responses = await Promise.all([
      postSns({ ...signed, Message: sesEvent('Complaint', providerMessageId) }),
      postSns(getSnsSigner().sign({
        Type: 'Notification',
        TopicArn: TEST_TOPIC_ARN.replace('ses-events', 'other-topic'),
        Message: sesEvent('Delivery', providerMessageId),
      })),
      postSns(getSnsSigner().sign({
        Type: 'Notification',
        SigningCertURL: 'https://certs.example.com/sns.pem',
        Message: sesEvent('Delivery', providerMessageId),
      })),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403]);
    expect(responses.map((response) => response.json<{ error: { code: string } }>().error.code))
      .toEqual(Array(3).fill('EMAIL_EVENT_UNVERIFIED'));
    expect(await getPrisma().emailMessage.findFirst({ where: { providerMessageId } })).toMatchObject({ status: 'SENT' });
  });

  it('confirms a signed subscription confirmation by visiting its SNS subscribe URL, and refuses one whose URL is not SNS\'s', async () => {
    const subscribeUrl = 'https://sns.us-east-2.amazonaws.com/?Action=ConfirmSubscription&Token=integration';

    const confirmed = await postSns(getSnsSigner().sign({ Type: 'SubscriptionConfirmation', SubscribeURL: subscribeUrl, Token: 'integration' }));
    const refused = await postSns(getSnsSigner().sign({
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'https://evil.example.com/confirm',
      Token: 'integration',
    }));

    expect(confirmed.statusCode).toBe(200);
    expect(refused.statusCode).toBe(403);
    expect(getConfirmedSnsSubscriptions()).toEqual([subscribeUrl]);
  });

  it('answers 200 to an event for an email this environment never sent, so SNS does not retry it', async () => {
    const response = await postSns(notification(sesEvent('Delivery', 'not-ours-at-all')));

    expect(response.statusCode).toBe(200);
  });
});

describe('email suppression and delivery outcome queries', () => {
  const suppressions = () => new PrismaEmailSuppressionRepository(getPrisma());
  const messages = () => new PrismaEmailMessageRepository(getPrisma());

  it('suppresses an address once, lower-cased, keeps the first reason, and finds it whatever its case', async () => {
    const address = `Suppressed-${String(Date.now())}@Integration.Test`;

    await suppressions().suppress({ email: address, suppressionReason: 'BOUNCE' });
    await suppressions().suppress({ email: address.toUpperCase(), suppressionReason: 'COMPLAINT' });

    const rows = await getPrisma().emailSuppression.findMany({ where: { email: address.toLowerCase() } });
    expect(rows).toHaveLength(1);
    expect(rows[0].suppressionReason).toBe('BOUNCE');
    expect(await suppressions().findByEmail(address.toUpperCase())).toMatchObject({ email: address.toLowerCase(), suppressionReason: 'BOUNCE' });
    expect(await suppressions().findByEmail(`nobody-${String(Date.now())}@integration.test`)).toBeUndefined();
  });

  it('refuses a suppression row whose address is not lower case', async () => {
    await expect(getPrisma().emailSuppression.create({
      data: { email: `Mixed-${String(Date.now())}@integration.test`, suppressionReason: 'BOUNCE' },
    })).rejects.toThrow();
  });

  it('records an outcome only forward from where the email stands, and returns undefined for an id it never sent', async () => {
    const { providerMessageId } = await sentInvite();

    const delivered = await messages().recordDeliveryOutcome(providerMessageId, { status: 'DELIVERED' });
    const bounced = await messages().recordDeliveryOutcome(providerMessageId, { status: 'BOUNCED', error: 'Bounced: Permanent' });
    const lateDelivery = await messages().recordDeliveryOutcome(providerMessageId, { status: 'DELIVERED' });
    const unknown = await messages().recordDeliveryOutcome('never-sent', { status: 'DELIVERED' });

    expect([delivered?.status, bounced?.status, lateDelivery?.status]).toEqual(['DELIVERED', 'BOUNCED', 'BOUNCED']);
    expect(bounced?.lastError).toBe('Bounced: Permanent');
    expect(unknown).toBeUndefined();
  });
});
