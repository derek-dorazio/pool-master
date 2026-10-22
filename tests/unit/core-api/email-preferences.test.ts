/**
 * Email preferences and unsubscribe links (#844 slice 5): the token an email's link carries, and
 * the switches a member turns on and off on their account or by that link.
 */
import { expect } from '@jest/globals';
import {
  EmailPreferencesService,
  EmailUnsubscribeLinkInvalidError,
  UnsubscribeTokens,
} from '../../../packages/core-api/src/modules/email';
import { AuthProvider, type User } from '../../../packages/shared/domain';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailOptOuts, inMemoryEmailSuppressions } from '../../support/in-memory-email-messages';
import { fakeUserRepo } from '../../support/repo-fakes';

const USER: User = {
  id: 'user-1',
  email: 'morgan@gmail.com',
  username: 'morgan',
  firstName: 'Morgan',
  lastName: 'Member',
  isActive: true,
  isRootAdmin: false,
  authProvider: AuthProvider.EMAIL,
  createdAt: new Date('2026-04-21T00:00:00.000Z'),
  updatedAt: new Date('2026-04-21T00:00:00.000Z'),
};

describe('unsubscribe tokens', () => {
  const tokens = new UnsubscribeTokens('secret-one');

  it('reads back the user and category a token was issued for', () => {
    const token = tokens.issue({ userId: USER.id, category: 'LIVE_STANDINGS' });

    expect(tokens.read(token)).toEqual({ userId: USER.id, category: 'LIVE_STANDINGS' });
  });

  it('refuses a token whose user or category was changed, so one link cannot unsubscribe anyone else from anything else', () => {
    const [, category, mac] = tokens.issue({ userId: USER.id, category: 'RECEIPTS' }).split('.');
    const otherUser = Buffer.from('user-2', 'utf8').toString('base64url');
    const [encodedUser] = tokens.issue({ userId: USER.id, category: 'RECEIPTS' }).split('.');

    expect(tokens.read(`${otherUser}.${category}.${mac}`)).toBeUndefined();
    expect(tokens.read(`${encodedUser}.RESULTS.${mac}`)).toBeUndefined();
  });

  it('refuses a token signed with another secret, and anything that is not a token', () => {
    const foreign = new UnsubscribeTokens('secret-two').issue({ userId: USER.id, category: 'RECEIPTS' });

    expect(tokens.read(foreign)).toBeUndefined();
    expect(tokens.read('')).toBeUndefined();
    expect(tokens.read('a.b')).toBeUndefined();
    expect(tokens.read(`${foreign}.extra`)).toBeUndefined();
  });

  it('refuses a correctly signed token for a category that cannot be turned off', () => {
    const [encodedUser, , mac] = tokens.issue({ userId: USER.id, category: 'RECEIPTS' }).split('.');

    expect(tokens.read(`${encodedUser}.ACCOUNT.${mac}`)).toBeUndefined();
  });
});

describe('email preferences service', () => {
  function preferencesWith(options: { userExists?: boolean } = {}) {
    const optOuts = inMemoryEmailOptOuts();
    const suppressions = inMemoryEmailSuppressions();
    const tokens = new UnsubscribeTokens('secret-one');
    const logger = fakeLogger();
    const service = new EmailPreferencesService({
      users: fakeUserRepo({ findById: jest.fn().mockResolvedValue(options.userExists === false ? null : USER) }),
      optOuts,
      suppressions,
      tokens,
      logger,
    });
    return { service, optOuts, suppressions, tokens, logger };
  }

  it('lists every category a member can turn off, all on for a member who turned none off, with no suppression', async () => {
    const { service } = preferencesWith();

    await expect(service.read(USER)).resolves.toEqual({
      preferences: [
        { category: 'COMMISSIONER_UPDATES', enabled: true },
        { category: 'CONTEST_UPDATES', enabled: true },
        { category: 'LIVE_STANDINGS', enabled: true },
        { category: 'RESULTS', enabled: true },
        { category: 'RECEIPTS', enabled: true },
      ],
      emailSuppression: null,
    });
  });

  it('turns one category off and back on, leaving the others as they were', async () => {
    const { service } = preferencesWith();

    const off = await service.set(USER, 'RESULTS', false);
    const on = await service.set(USER, 'RESULTS', true);

    expect(off.preferences.filter((preference) => !preference.enabled)).toEqual([{ category: 'RESULTS', enabled: false }]);
    expect(on.preferences.every((preference) => preference.enabled)).toBe(true);
  });

  it('says why the account gets no email at all when its address bounced for good', async () => {
    const { service, suppressions } = preferencesWith();
    await suppressions.suppress({ email: 'MORGAN@gmail.com', suppressionReason: 'BOUNCE' });

    await expect(service.read(USER)).resolves.toMatchObject({ emailSuppression: 'BOUNCE' });
  });

  it('turns off the category an unsubscribe link names for the user it names, and repeating it changes nothing', async () => {
    const { service, tokens } = preferencesWith();
    const token = tokens.issue({ userId: USER.id, category: 'LIVE_STANDINGS' });

    await expect(service.unsubscribe(token)).resolves.toBe('LIVE_STANDINGS');
    await expect(service.unsubscribe(token)).resolves.toBe('LIVE_STANDINGS');

    const { preferences } = await service.read(USER);
    expect(preferences.filter((preference) => !preference.enabled)).toEqual([{ category: 'LIVE_STANDINGS', enabled: false }]);
  });

  it('refuses an unsubscribe link this app did not issue, and logs the refusal without the token', async () => {
    const { service, logger } = preferencesWith();
    const forged = new UnsubscribeTokens('another-secret').issue({ userId: USER.id, category: 'RECEIPTS' });

    await expect(service.unsubscribe(forged)).rejects.toBeInstanceOf(EmailUnsubscribeLinkInvalidError);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(forged);
  });

  it('refuses a genuine unsubscribe link for an account since deleted', async () => {
    const { service, tokens, optOuts } = preferencesWith({ userExists: false });

    await expect(service.unsubscribe(tokens.issue({ userId: USER.id, category: 'RECEIPTS' })))
      .rejects.toMatchObject({ code: 'EMAIL_UNSUBSCRIBE_LINK_INVALID' });
    expect(optOuts.rows.size).toBe(0);
  });
});
