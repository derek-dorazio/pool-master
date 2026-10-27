import {
  changeUserPassword,
  confirmPasswordReset,
  loginUser,
  refreshToken,
  requestPasswordReset,
} from '@poolmaster/shared/generated/hey-api';
import { ErrorEnvelopeSchema, SuccessResponseSchema } from '@poolmaster/shared/dto';
import type { CapturedMail } from '../support/smtp-sink';
import { buildRegisteredUser } from './builders';
import { awaitSentMailTo, sentMailWithSubject } from './mail';
import {
  cleanupFunctionalData,
  createCookieSessionClient,
  createFunctionalEmail,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getSdkClient,
} from './setup';
import { FUNCTIONAL_APP_BASE_URL } from './state';
import { expectDefined } from '../support/expect-defined';

// #847 — "Forgot password?" end to end through the generated SDK: ask for a link, read it from
// the email the server sent, set a new password with it, and prove the old session and the old
// password are both dead. The request answers before the email is sent, so the inbox is polled.

const RESET_SUBJECT = 'Reset your Primetime Commissioner password';
const CHANGED_SUBJECT = 'Your Primetime Commissioner password was changed';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

function resetTokenIn(mail: CapturedMail): string {
  const prefix = `${FUNCTIONAL_APP_BASE_URL}/reset-password#token=`;
  const start = mail.text.indexOf(prefix);
  const match = start < 0 ? null : /^[A-Za-z0-9_-]+/.exec(mail.text.slice(start + prefix.length));
  if (!match?.[0]) throw new Error('The reset email carries no reset link');
  return match[0];
}

describe('SDK Functional: password recovery (#847)', () => {
  it('a reset link sets a new password, signs out the old session, and the new password signs in', async () => {
    const user = await buildRegisteredUser({ password: 'Original-Pass1' });

    const requested = await requestPasswordReset({
      client: getSdkClient(),
      body: { identifier: ` ${user.email.toUpperCase()} ` },
    });
    expect(requested.response.status).toBe(202);
    expect(SuccessResponseSchema.safeParse(requested.data).success).toBe(true);

    const mail = expectDefined((await awaitSentMailTo(user.email, 1, RESET_SUBJECT))[0]);
    const confirmed = await confirmPasswordReset({
      client: getSdkClient(),
      body: { token: resetTokenIn(mail), newPassword: 'Recovered-Pass2', confirmNewPassword: 'Recovered-Pass2' },
    });
    expect(confirmed.response.status).toBe(200);
    expect(SuccessResponseSchema.safeParse(confirmed.data).success).toBe(true);

    expectFunctionalError(
      await refreshToken({ client: createCookieSessionClient(user.login.tokens) }),
      { status: 401, code: 'INVALID_REFRESH_TOKEN' },
    );
    expectFunctionalError(
      await loginUser({ client: getSdkClient(), body: { identifier: user.username, password: 'Original-Pass1' } }),
      { status: 401, code: 'INVALID_CREDENTIALS' },
    );
    const signedIn = await loginUser({
      client: getSdkClient(),
      body: { identifier: user.username, password: 'Recovered-Pass2' },
    });
    expect(signedIn.data?.user.id).toBe(user.userId);
    expect(await awaitSentMailTo(user.email, 1, CHANGED_SUBJECT)).toHaveLength(1);
  });

  it('emails the account when its owner changes the password from My account', async () => {
    const user = await buildRegisteredUser({ password: 'Original-Pass1' });

    const changed = await changeUserPassword({
      client: user.client,
      path: { userId: 'me' },
      body: { currentPassword: 'Original-Pass1', newPassword: 'Changed-Pass2', confirmNewPassword: 'Changed-Pass2' },
    });

    expect(changed.data).toEqual({ success: true });
    const [mail] = await awaitSentMailTo(user.email, 1, CHANGED_SUBJECT);
    expect(expectDefined(mail).text).toContain(`${FUNCTIONAL_APP_BASE_URL}/forgot-password`);
  });

  it('answers an unknown email exactly as it answers a known one, and sends nothing', async () => {
    const unknownEmail = createFunctionalEmail('nobody');
    const known = await buildRegisteredUser();

    const unknownAnswer = await requestPasswordReset({
      client: getSdkClient(),
      body: { identifier: unknownEmail },
    });
    const knownAnswer = await requestPasswordReset({
      client: getSdkClient(),
      body: { identifier: known.email },
    });

    expect(unknownAnswer.response.status).toBe(202);
    expect(unknownAnswer.data).toEqual(knownAnswer.data);
    // The known account's email is the control: once it has arrived, the earlier unknown
    // request has long finished its single lookup.
    expect(await awaitSentMailTo(known.email, 1, RESET_SUBJECT)).toHaveLength(1);
    expect(await sentMailWithSubject(unknownEmail, RESET_SUBJECT)).toHaveLength(0);
  });

  it('refuses a used link with PASSWORD_RESET_LINK_INVALID in the error envelope', async () => {
    const user = await buildRegisteredUser();
    await requestPasswordReset({ client: getSdkClient(), body: { identifier: user.username } });
    const token = resetTokenIn(expectDefined((await awaitSentMailTo(user.email, 1, RESET_SUBJECT))[0]));
    await confirmPasswordReset({
      client: getSdkClient(),
      body: { token, newPassword: 'Recovered-Pass2', confirmNewPassword: 'Recovered-Pass2' },
    });

    const reused = await confirmPasswordReset({
      client: getSdkClient(),
      body: { token, newPassword: 'Another-Pass3', confirmNewPassword: 'Another-Pass3' },
    });

    expectFunctionalError(reused, { status: 400, code: 'PASSWORD_RESET_LINK_INVALID' });
    expect(ErrorEnvelopeSchema.safeParse(reused.error).success).toBe(true);
  });

  it('refuses a too-short new password before it looks at the link', async () => {
    const result = await confirmPasswordReset({
      client: getSdkClient(),
      body: { token: 'any-token', newPassword: 'short', confirmNewPassword: 'short' },
    });

    expect(result.response.status).toBe(400);
    expect(ErrorEnvelopeSchema.safeParse(result.error).success).toBe(true);
  });
});
