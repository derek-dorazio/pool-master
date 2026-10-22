import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  EMAIL_SETTINGS,
  EmailService,
  type EmailSendInput,
  type MailDeliveryProviderName,
} from '../../../packages/core-api/src/modules/email';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryEmailMessages, type InMemoryEmailMessages } from '../../support/in-memory-email-messages';

const LEAGUE = { id: 'league-1', name: 'Office League', leagueCode: 'OFFICE24' };
const NOW = new Date('2026-10-22T12:00:00.000Z');

function invite(to: string, overrides: Partial<EmailSendInput<'LEAGUE_MEMBER_INVITE'>> = {}): EmailSendInput<'LEAGUE_MEMBER_INVITE'> {
  return {
    to: { email: to },
    about: 'invite-1:abc',
    league: LEAGUE,
    refs: { invitationId: 'invite-1' },
    data: {
      recipientEmail: to,
      inviterName: 'Casey Commissioner',
      leagueName: LEAGUE.name,
      leagueCode: LEAGUE.leagueCode,
      inviteUrl: 'https://qa.example.com/invite/abc',
      expiresAt: new Date('2026-10-29T18:30:00.000Z'),
    },
    ...overrides,
  };
}

function emailConfig(overrides: Partial<EmailConfig> = {}): EmailConfig {
  return { ...EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }), ...overrides };
}

function service(options: {
  outbox?: InMemoryEmailMessages;
  providerName?: MailDeliveryProviderName;
  readConfig?: () => EmailConfig;
  logger?: ReturnType<typeof fakeLogger>;
  onQueued?: () => void;
} = {}) {
  return new EmailService({
    messages: options.outbox ?? inMemoryEmailMessages(),
    providerName: options.providerName ?? 'smtp',
    readConfig: options.readConfig ?? (() => emailConfig()),
    senderAddress: 'noreply@qa.example.com',
    onQueued: options.onQueued,
    logger: options.logger ?? fakeLogger(),
    now: () => NOW,
  });
}

describe('email service: what it queues', () => {
  it('queues one rendered email to the one recipient, due now, from the league\'s address in the league\'s name, with its refs', async () => {
    const outbox = inMemoryEmailMessages();
    const onQueued = jest.fn();

    const message = await service({ outbox, onQueued }).send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'));

    expect(message.status).toBe('QUEUED');
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({
      templateKey: 'LEAGUE_MEMBER_INVITE',
      recipientEmail: 'member@gmail.com',
      fromName: 'Office League',
      fromAddress: 'office24@qa.example.com',
      subject: 'Casey Commissioner invited you to Office League',
      leagueId: 'league-1',
      invitationId: 'invite-1',
      nextAttemptAt: NOW,
      attempts: 0,
    });
    expect(outbox.rows[0].textBody).toContain('Join league: https://qa.example.com/invite/abc');
    expect(outbox.rows[0].htmlBody).toContain('Office League');
    expect(onQueued).toHaveBeenCalledTimes(1);
  });

  it('records the same email once however often it is sent, keyed by template, subject and recipient', async () => {
    const outbox = inMemoryEmailMessages();
    const onQueued = jest.fn();
    const email = service({ outbox, onQueued });

    const first = await email.send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'));
    const again = await email.send('LEAGUE_MEMBER_INVITE', invite('Member@Gmail.com'));

    expect(again.id).toBe(first.id);
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].idempotencyKey).toBe('LEAGUE_MEMBER_INVITE:invite-1:abc:member@gmail.com');
    expect(onQueued).toHaveBeenCalledTimes(1);
  });

  it('keys an email to someone with an account by their user id, so a changed address is still the same recipient', async () => {
    const outbox = inMemoryEmailMessages();

    await service({ outbox }).send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com', {
      to: { email: 'member@gmail.com', userId: 'user-7' },
      about: 'invite-1',
    }));

    expect(outbox.rows[0]).toMatchObject({ recipientUserId: 'user-7', idempotencyKey: 'LEAGUE_MEMBER_INVITE:invite-1:user-7' });
  });

  it('queues a new subject as a new email', async () => {
    const outbox = inMemoryEmailMessages();
    const email = service({ outbox });

    await email.send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com', { about: 'invite-1:code-a' }));
    await email.send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com', { about: 'invite-1:code-b' }));

    expect(outbox.rows).toHaveLength(2);
  });

  it('sends a league whose code is a role address, made before codes were reserved, from noreply@ in the league\'s name', async () => {
    const outbox = inMemoryEmailMessages();

    await service({ outbox }).send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com', {
      league: { ...LEAGUE, leagueCode: 'admin' },
    }));

    expect(outbox.rows[0]).toMatchObject({ fromName: 'Office League', fromAddress: 'noreply@qa.example.com' });
  });

  it('shows dates in the recipient\'s time zone, named, and in UTC when they have none', async () => {
    const outbox = inMemoryEmailMessages();
    const email = service({ outbox });

    await email.send('LEAGUE_MEMBER_INVITE', invite('east@gmail.com', { to: { email: 'east@gmail.com', timeZone: 'America/New_York' } }));
    await email.send('LEAGUE_MEMBER_INVITE', invite('nozone@gmail.com'));

    expect(outbox.rows[0].textBody).toContain('Expires: Oct 29, 2026, 2:30 PM EDT');
    expect(outbox.rows[1].textBody).toContain('Expires: Oct 29, 2026, 6:30 PM UTC');
  });

  it('shows dates in UTC, and logs it, when the recipient\'s stored time zone is unknown', async () => {
    const outbox = inMemoryEmailMessages();
    const logger = fakeLogger();

    await service({ outbox, logger })
      .send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com', { to: { email: 'member@gmail.com', timeZone: 'Mars/Olympus' } }));

    expect(outbox.rows[0].textBody).toContain('Expires: Oct 29, 2026, 6:30 PM UTC');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.send.unknownTimeZone' }),
      expect.any(String),
    );
  });

  it('passes a failed outbox write on to the caller', async () => {
    const outbox = inMemoryEmailMessages();
    outbox.record = () => Promise.reject(new Error('database unavailable'));

    await expect(service({ outbox }).send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'))).rejects.toThrow('database unavailable');
  });

  it('reports the latest invite email\'s status for each invitation', async () => {
    const outbox = inMemoryEmailMessages();
    const email = service({ outbox, readConfig: () => emailConfig({ allowedRecipients: ['@gmail.com'] }) });
    await email.send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com', { about: 'invite-1:a' }));
    await email.send('LEAGUE_MEMBER_INVITE', invite('member@outlook.com', {
      about: 'invite-2:a',
      refs: { invitationId: 'invite-2' },
    }));

    const statuses = await email.latestInviteStatusByInvitation(['invite-1', 'invite-2', 'invite-3']);

    expect(Object.fromEntries(statuses)).toEqual({ 'invite-1': 'QUEUED', 'invite-2': 'SKIPPED' });
  });
});

describe('email service: EMAIL_CONFIG switches', () => {
  it('with email switched off, records the email as skipped without content, queues nothing, and logs ids but no address', async () => {
    const outbox = inMemoryEmailMessages();
    const logger = fakeLogger();
    const onQueued = jest.fn();

    const message = await service({ outbox, logger, onQueued, readConfig: () => emailConfig({ enabled: false }) })
      .send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'));

    expect(message).toMatchObject({ status: 'SKIPPED', skipReason: 'EMAIL_DISABLED' });
    expect(outbox.rows[0].subject).toBeUndefined();
    expect(outbox.rows[0].textBody).toBeUndefined();
    expect(onQueued).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      {
        action: 'email.send.skip',
        data: {
          reason: 'EMAIL_DISABLED',
          templateKey: 'LEAGUE_MEMBER_INVITE',
          leagueId: 'league-1',
          contestId: null,
          entryId: null,
          invitationId: 'invite-1',
        },
      },
      expect.any(String),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('member@gmail.com');
  });

  it('skips only the template switched off and still queues the others', async () => {
    const outbox = inMemoryEmailMessages();
    const config = emailConfig();
    const email = service({ outbox, readConfig: () => ({ ...config, templates: { ...config.templates, LEAGUE_MEMBER_INVITE: false } }) });

    const skipped = await email.send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'));
    await email.send('LEAGUE_JOIN_SUCCESS', {
      to: { email: 'member@gmail.com', userId: 'user-1' },
      about: 'invite-1',
      league: LEAGUE,
      data: { userName: 'Morgan', leagueName: LEAGUE.name, leagueCode: LEAGUE.leagueCode, leagueHomeUrl: 'https://qa.example.com/league/OFFICE24' },
    });

    expect(skipped.skipReason).toBe('TEMPLATE_DISABLED');
    expect(outbox.rows.map((row) => [row.templateKey, row.status])).toEqual([
      ['LEAGUE_MEMBER_INVITE', 'SKIPPED'],
      ['LEAGUE_JOIN_SUCCESS', 'QUEUED'],
    ]);
  });

  it('queues a password reset from the app address even with every template switch off, since it has no switch', async () => {
    const outbox = inMemoryEmailMessages();
    const config = emailConfig();
    const allOff = Object.fromEntries(Object.keys(config.templates).map((key) => [key, false])) as typeof config.templates;
    const email = service({ outbox, readConfig: () => ({ ...config, templates: allOff }) });

    const message = await email.send('PASSWORD_RESET', {
      to: { email: 'member@gmail.com', userId: 'user-1' },
      about: 'reset-1',
      data: { firstName: 'Morgan', username: 'morgan', resetUrl: 'https://qa.example.com/reset-password#token=abc', expiresInMinutes: 10 },
    });

    expect(message).toMatchObject({
      templateKey: 'PASSWORD_RESET',
      status: 'QUEUED',
      fromName: 'Prime Time Commissioner',
      fromAddress: 'noreply@qa.example.com',
    });
  });

  it('reads the setting on every email, so a change applies to the next one without a restart', async () => {
    const outbox = inMemoryEmailMessages();
    let config = emailConfig({ enabled: false });
    const email = service({ outbox, readConfig: () => config });

    await email.send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com', { about: 'first' }));
    config = emailConfig({ enabled: true });
    await email.send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com', { about: 'second' }));

    expect(outbox.rows.map((row) => row.status)).toEqual(['SKIPPED', 'QUEUED']);
  });

  it('reports a switched-off email as switched off, not as a recipient problem', async () => {
    const message = await service({ providerName: 'ses', readConfig: () => emailConfig({ enabled: false }) })
      .send('LEAGUE_MEMBER_INVITE', invite('smoke@e2e.invalid'));

    expect(message.skipReason).toBe('EMAIL_DISABLED');
  });
});

describe('email service: who may be emailed', () => {
  it('through SES, skips an email to a reserved domain such as the e2e smoke users\' @e2e.invalid, and logs no address', async () => {
    const outbox = inMemoryEmailMessages();
    const logger = fakeLogger();
    const email = service({ outbox, logger, providerName: 'ses' });

    const results = await Promise.all(
      ['smoke@e2e.invalid', 'a@b.test', 'c@d.example', 'e@localhost', 'f@example.com', 'g@mail.example.org']
        .map((to) => email.send('LEAGUE_MEMBER_INVITE', invite(to))),
    );

    expect(results.map((result) => result.skipReason)).toEqual(Array(6).fill('NOT_ALLOWED_IN_ENVIRONMENT'));
    expect(outbox.rows.every((row) => row.status === 'SKIPPED')).toBe(true);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('e2e.invalid');
  });

  it('through SES, still queues an email to a domain that only looks like a reserved one', async () => {
    const message = await service({ providerName: 'ses' }).send('LEAGUE_MEMBER_INVITE', invite('member@notexample.com'));

    expect(message.status).toBe('QUEUED');
  });

  it('through SMTP, queues email to reserved domains, since Mailpit and the test sink catch every address', async () => {
    const message = await service({ providerName: 'smtp' }).send('LEAGUE_MEMBER_INVITE', invite('member@example.test'));

    expect(message.status).toBe('QUEUED');
  });

  it('with an allow list, queues only listed addresses and @domains, ignoring case, and skips everyone else', async () => {
    const email = service({
      providerName: 'ses',
      readConfig: () => emailConfig({ allowedRecipients: ['derek+alice@gmail.com', '@simulator.amazonses.com'] }),
    });

    const results = await Promise.all([
      'Derek+Alice@Gmail.com',
      'bounce@simulator.amazonses.com',
      'derek+bob@gmail.com',
      'someone@sub.simulator.amazonses.com',
      'stranger@gmail.com',
    ].map((to) => email.send('LEAGUE_MEMBER_INVITE', invite(to))));

    expect(results.map((result) => result.skipReason ?? result.status)).toEqual([
      'QUEUED',
      'QUEUED',
      'NOT_ALLOWED_IN_ENVIRONMENT',
      'NOT_ALLOWED_IN_ENVIRONMENT',
      'NOT_ALLOWED_IN_ENVIRONMENT',
    ]);
    expect(results[0].recipientEmail).toBe('Derek+Alice@Gmail.com');
  });

  it('with an allow list, also limits SMTP delivery', async () => {
    const message = await service({ providerName: 'smtp', readConfig: () => emailConfig({ allowedRecipients: ['@poolmaster.local'] }) })
      .send('LEAGUE_MEMBER_INVITE', invite('member@example.test'));

    expect(message.skipReason).toBe('NOT_ALLOWED_IN_ENVIRONMENT');
  });
});
