import { loginUser, refreshToken, undoEmailChange, updateUserProfile } from '@poolmaster/shared/generated/hey-api';
import { SuccessResponseSchema } from '@poolmaster/shared/dto';
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

// #903 A5 — an account's email changes, the old address gets an email with a link, and the link
// puts the old address back and signs every session out, end to end through the generated SDK.

const CHANGED_SUBJECT = 'Your Prime Time Commissioner email address was changed';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

function undoTokenIn(mail: CapturedMail): string {
  const prefix = `${FUNCTIONAL_APP_BASE_URL}/undo-email-change#token=`;
  const start = mail.text.indexOf(prefix);
  const match = start < 0 ? null : /^[A-Za-z0-9_-]+/.exec(mail.text.slice(start + prefix.length));
  if (!match?.[0]) throw new Error('The email carries no undo link');
  return match[0];
}

describe('SDK Functional: undoing an email change (#903 A5)', () => {
  it('emails the old address when the email changes, and its link puts the address back and signs everyone out', async () => {
    const user = await buildRegisteredUser({ password: 'Original-Pass1' });
    const newEmail = createFunctionalEmail('taken-over');

    const changed = await updateUserProfile({
      client: createCookieSessionClient(user.login.tokens),
      path: { userId: 'me' },
      body: { firstName: 'Taken', lastName: 'Over', email: newEmail },
    });
    expect(changed.data?.user.email).toBe(newEmail);

    const mail = expectDefined((await awaitSentMailTo(user.email, 1, CHANGED_SUBJECT))[0]);
    expect(mail.text).toContain(`was changed to ${newEmail} on`);
    expect(await sentMailWithSubject(newEmail, CHANGED_SUBJECT)).toHaveLength(0);

    const undone = await undoEmailChange({ client: getSdkClient(), body: { token: undoTokenIn(mail) } });
    expect(undone.response.status).toBe(200);
    expect(SuccessResponseSchema.safeParse(undone.data).success).toBe(true);

    expectFunctionalError(
      await refreshToken({ client: createCookieSessionClient(user.login.tokens) }),
      { status: 401, code: 'INVALID_REFRESH_TOKEN' },
    );
    const signedIn = await loginUser({ client: getSdkClient(), body: { identifier: user.email, password: 'Original-Pass1' } });
    expect(signedIn.data?.user.email).toBe(user.email);
  });

  it('refuses a used link with EMAIL_CHANGE_UNDO_LINK_INVALID in the error envelope', async () => {
    const user = await buildRegisteredUser();
    await updateUserProfile({
      client: createCookieSessionClient(user.login.tokens),
      path: { userId: 'me' },
      body: { firstName: 'Taken', lastName: 'Over', email: createFunctionalEmail('taken-over') },
    });
    const token = undoTokenIn(expectDefined((await awaitSentMailTo(user.email, 1, CHANGED_SUBJECT))[0]));
    await undoEmailChange({ client: getSdkClient(), body: { token } });

    expectFunctionalError(
      await undoEmailChange({ client: getSdkClient(), body: { token } }),
      { status: 400, code: 'EMAIL_CHANGE_UNDO_LINK_INVALID' },
    );
  });
});
