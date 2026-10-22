import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  EMAIL_SETTINGS,
  EmailService,
  type EmailSendInput,
  type MailDeliveryMessage,
  type MailDeliveryProvider,
  type MailDeliveryProviderName,
} from '../../../packages/core-api/src/modules/email';
import { fakeLogger } from '../../support/fake-logger';

const LEAGUE = { id: 'league-1', name: 'Office League', leagueCode: 'OFFICE24' };

function invite(to: string, overrides: Partial<EmailSendInput<'LEAGUE_MEMBER_INVITE'>> = {}): EmailSendInput<'LEAGUE_MEMBER_INVITE'> {
  return {
    to: { email: to },
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

function recordingTransport(
  providerName: MailDeliveryProviderName = 'smtp',
): MailDeliveryProvider & { sent: MailDeliveryMessage[] } {
  const sent: MailDeliveryMessage[] = [];
  return {
    providerName,
    sent,
    send: (message) => {
      sent.push(message);
      return Promise.resolve({ provider: providerName, messageId: `message-${sent.length}` });
    },
  };
}

function emailConfig(overrides: Partial<EmailConfig> = {}): EmailConfig {
  return { ...EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }), ...overrides };
}

function service(
  transport: MailDeliveryProvider,
  readConfig: () => EmailConfig = () => emailConfig(),
  logger = fakeLogger(),
) {
  return new EmailService({ transport, readConfig, senderAddress: 'noreply@qa.example.com', logger });
}

describe('email service: what it hands the transport', () => {
  it('sends one rendered email to the one recipient, from the league\'s address in the league\'s name, with its refs', async () => {
    const transport = recordingTransport();

    const result = await service(transport).send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'));

    expect(result).toEqual({ provider: 'smtp', messageId: 'message-1' });
    expect(transport.sent).toHaveLength(1);
    const [message] = transport.sent;
    expect(message.from).toEqual({ name: 'Office League', address: 'office24@qa.example.com' });
    expect(message.to).toBe('member@gmail.com');
    expect(message.subject).toBe('Casey Commissioner invited you to Office League');
    expect(message.text).toContain('Join league: https://qa.example.com/invite/abc');
    expect(message.metadata).toEqual({
      templateKey: 'LEAGUE_MEMBER_INVITE',
      leagueId: 'league-1',
      contestId: undefined,
      entryId: undefined,
      invitationId: 'invite-1',
    });
  });

  it('sends a league whose code is a role address, made before codes were reserved, from noreply@ in the league\'s name', async () => {
    const transport = recordingTransport();

    await service(transport).send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com', {
      league: { ...LEAGUE, leagueCode: 'admin' },
    }));

    expect(transport.sent[0].from).toEqual({ name: 'Office League', address: 'noreply@qa.example.com' });
  });

  it('shows dates in the recipient\'s time zone, named, and in UTC when they have none', async () => {
    const transport = recordingTransport();
    const email = service(transport);

    await email.send('LEAGUE_MEMBER_INVITE', invite('east@gmail.com', { to: { email: 'east@gmail.com', timeZone: 'America/New_York' } }));
    await email.send('LEAGUE_MEMBER_INVITE', invite('nozone@gmail.com'));

    expect(transport.sent[0].text).toContain('Expires: Oct 29, 2026, 2:30 PM EDT');
    expect(transport.sent[1].text).toContain('Expires: Oct 29, 2026, 6:30 PM UTC');
  });

  it('shows dates in UTC, and logs it, when the recipient\'s stored time zone is unknown', async () => {
    const transport = recordingTransport();
    const logger = fakeLogger();

    await service(transport, () => emailConfig(), logger)
      .send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com', { to: { email: 'member@gmail.com', timeZone: 'Mars/Olympus' } }));

    expect(transport.sent[0].text).toContain('Expires: Oct 29, 2026, 6:30 PM UTC');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.send.unknownTimeZone' }),
      expect.any(String),
    );
  });

  it('passes a transport failure on to the caller', async () => {
    const transport: MailDeliveryProvider = {
      providerName: 'ses',
      send: () => Promise.reject(new Error('SES refused')),
    };

    await expect(service(transport).send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'))).rejects.toThrow('SES refused');
  });
});

describe('email service: EMAIL_CONFIG switches', () => {
  it('with email switched off, reports success without sending and logs the skip with ids but no content or address', async () => {
    const transport = recordingTransport();
    const logger = fakeLogger();

    const result = await service(transport, () => emailConfig({ enabled: false }), logger)
      .send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'));

    expect(result).toEqual({ provider: 'smtp', skipped: 'EMAIL_DISABLED' });
    expect(transport.sent).toHaveLength(0);
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

  it('skips only the template switched off and still sends the others', async () => {
    const transport = recordingTransport();
    const config = emailConfig();
    const email = service(transport, () => ({ ...config, templates: { ...config.templates, LEAGUE_MEMBER_INVITE: false } }));

    const skipped = await email.send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'));
    await email.send('LEAGUE_JOIN_SUCCESS', {
      to: { email: 'member@gmail.com' },
      league: LEAGUE,
      data: { userName: 'Morgan', leagueName: LEAGUE.name, leagueCode: LEAGUE.leagueCode, leagueHomeUrl: 'https://qa.example.com/league/OFFICE24' },
    });

    expect(skipped.skipped).toBe('TEMPLATE_DISABLED');
    expect(transport.sent.map((message) => message.metadata.templateKey)).toEqual(['LEAGUE_JOIN_SUCCESS']);
  });

  it('reads the setting on every send, so a change applies to the next email without a restart', async () => {
    const transport = recordingTransport();
    let config = emailConfig({ enabled: false });
    const email = service(transport, () => config);

    await email.send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'));
    config = emailConfig({ enabled: true });
    await email.send('LEAGUE_MEMBER_INVITE', invite('member@gmail.com'));

    expect(transport.sent).toHaveLength(1);
  });

  it('reports a switched-off email as switched off, not as a recipient problem', async () => {
    const result = await service(recordingTransport('ses'), () => emailConfig({ enabled: false }))
      .send('LEAGUE_MEMBER_INVITE', invite('smoke@e2e.invalid'));

    expect(result.skipped).toBe('EMAIL_DISABLED');
  });
});

describe('email service: who may be emailed', () => {
  it('through SES, skips an email to a reserved domain such as the e2e smoke users\' @e2e.invalid, and logs no address', async () => {
    const transport = recordingTransport('ses');
    const logger = fakeLogger();
    const email = service(transport, () => emailConfig(), logger);

    const results = await Promise.all(
      ['smoke@e2e.invalid', 'a@b.test', 'c@d.example', 'e@localhost', 'f@example.com', 'g@mail.example.org']
        .map((to) => email.send('LEAGUE_MEMBER_INVITE', invite(to))),
    );

    expect(results.map((result) => result.skipped)).toEqual(Array(6).fill('NOT_ALLOWED_IN_ENVIRONMENT'));
    expect(transport.sent).toHaveLength(0);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('e2e.invalid');
  });

  it('through SES, still sends to a domain that only looks like a reserved one', async () => {
    const transport = recordingTransport('ses');

    const result = await service(transport).send('LEAGUE_MEMBER_INVITE', invite('member@notexample.com'));

    expect(result.skipped).toBeUndefined();
    expect(transport.sent.map((message) => message.to)).toEqual(['member@notexample.com']);
  });

  it('through SMTP, sends to reserved domains, since Mailpit and the test sink catch every address', async () => {
    const transport = recordingTransport('smtp');

    await service(transport).send('LEAGUE_MEMBER_INVITE', invite('member@example.test'));

    expect(transport.sent).toHaveLength(1);
  });

  it('with an allow list, sends only to listed addresses and @domains, ignoring case, and skips everyone else', async () => {
    const transport = recordingTransport('ses');
    const email = service(transport, () => emailConfig({
      allowedRecipients: ['derek+alice@gmail.com', '@simulator.amazonses.com'],
    }));

    const results = await Promise.all([
      'Derek+Alice@Gmail.com',
      'bounce@simulator.amazonses.com',
      'derek+bob@gmail.com',
      'someone@sub.simulator.amazonses.com',
      'stranger@gmail.com',
    ].map((to) => email.send('LEAGUE_MEMBER_INVITE', invite(to))));

    expect(results.map((result) => result.skipped ?? 'SENT')).toEqual([
      'SENT',
      'SENT',
      'NOT_ALLOWED_IN_ENVIRONMENT',
      'NOT_ALLOWED_IN_ENVIRONMENT',
      'NOT_ALLOWED_IN_ENVIRONMENT',
    ]);
    expect(transport.sent.map((message) => message.to)).toEqual(['Derek+Alice@Gmail.com', 'bounce@simulator.amazonses.com']);
  });

  it('with an allow list, also limits SMTP delivery', async () => {
    const transport = recordingTransport('smtp');

    const result = await service(transport, () => emailConfig({ allowedRecipients: ['@poolmaster.local'] }))
      .send('LEAGUE_MEMBER_INVITE', invite('member@example.test'));

    expect(result.skipped).toBe('NOT_ALLOWED_IN_ENVIRONMENT');
    expect(transport.sent).toHaveLength(0);
  });
});
