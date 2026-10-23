import { type SendEmailCommand } from '@aws-sdk/client-sesv2';
import { EmailConfigSchema } from '@poolmaster/shared/dto';
import {
  EMAIL_SETTINGS,
  MailDeliveryConfigError,
  MailDeliveryError,
  MailDeliveryThrottledError,
  SesMailDeliveryProvider,
  formatMailAddress,
  readApplicationBaseUrl,
  readMailDeliveryConfig,
} from '../../../packages/core-api/src/modules/email';
import { fakeLogger } from '../../support/fake-logger';

describe('pool-master-7ij mail delivery provider configuration', () => {
  it('selects SMTP for local Mailpit-friendly delivery', () => {
    const config = readMailDeliveryConfig({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'mailpit',
      SMTP_PORT: '1025',
      SMTP_FROM: 'noreply@poolmaster.local',
    });

    expect(config).toEqual({
      provider: 'smtp',
      fromEmail: 'noreply@poolmaster.local',
      smtp: {
        host: 'mailpit',
        port: 1025,
        secure: false,
        username: undefined,
        password: undefined,
      },
    });
  });

  it('selects SES for deployed delivery with AWS endpoint overrides when present', () => {
    const config = readMailDeliveryConfig({
      EMAIL_PROVIDER: 'ses',
      AWS_REGION: 'us-east-2',
      AWS_ENDPOINT: 'http://localhost:4566',
      AWS_ACCESS_KEY_ID: 'test-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret',
      SES_FROM_EMAIL: 'noreply@example.com',
      SES_CONFIGURATION_SET: 'poolmaster-qa',
    });

    expect(config).toEqual({
      provider: 'ses',
      fromEmail: 'noreply@example.com',
      ses: {
        region: 'us-east-2',
        endpoint: 'http://localhost:4566',
        configurationSetName: 'poolmaster-qa',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
    });
  });

  it('refuses EMAIL_PROVIDER=disabled, which EMAIL_CONFIG replaced', () => {
    expect(() => readMailDeliveryConfig({ EMAIL_PROVIDER: 'disabled' })).toThrow(MailDeliveryConfigError);
  });

  it('rejects unsupported providers', () => {
    expect(() => readMailDeliveryConfig({ EMAIL_PROVIDER: 'unsupported-provider' })).toThrow(
      MailDeliveryConfigError,
    );
  });

  it('normalizes the application base URL for invite links', () => {
    expect(readApplicationBaseUrl({ APP_BASE_URL: 'https://qa.example.com///' })).toBe(
      'https://qa.example.com',
    );
  });
});

describe('pool-master-7ij SES mail delivery provider', () => {
  it('submits one email to SES v2 from the given sender, through the configuration set, without logging message content', async () => {
    const sentCommands: SendEmailCommand[] = [];
    const client = {
      send: jest.fn(async (command: SendEmailCommand) => {
        sentCommands.push(command);
        return { MessageId: 'ses-message-1', $metadata: {} };
      }),
    };
    const logger = fakeLogger();
    const provider = new SesMailDeliveryProvider(
      {
        provider: 'ses',
        fromEmail: 'noreply@example.com',
        ses: {
          region: 'us-east-2',
          configurationSetName: 'poolmaster-qa',
        },
      },
      client,
      logger,
    );

    const result = await provider.send({
      from: { name: 'Office League', address: 'officeleague@qa.example.com' },
      to: 'member@example.com',
      subject: 'League invitation',
      text: 'Plain text body',
      html: '<p>HTML body</p>',
      metadata: {
        templateKey: 'LEAGUE_MEMBER_INVITE',
        leagueId: 'league-1',
        invitationId: 'invite-1',
      },
    });

    expect(result).toEqual({ provider: 'ses', messageId: 'ses-message-1' });
    expect(sentCommands).toHaveLength(1);
    expect(sentCommands[0].input).toEqual({
      FromEmailAddress: '"Office League" <officeleague@qa.example.com>',
      Destination: { ToAddresses: ['member@example.com'] },
      ConfigurationSetName: 'poolmaster-qa',
      Content: {
        Simple: {
          Subject: { Data: 'League invitation', Charset: 'UTF-8' },
          Body: {
            Text: { Data: 'Plain text body', Charset: 'UTF-8' },
            Html: { Data: '<p>HTML body</p>', Charset: 'UTF-8' },
          },
        },
      },
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('Plain text body');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('HTML body');
  });

  it.each([
    ['TooManyRequestsException', MailDeliveryThrottledError],
    ['MessageRejected', MailDeliveryError],
  ])('reports an SES %s as %p, so only sending too fast is retried without counting the try', async (name, expected) => {
    const refusal = Object.assign(new Error('SES refused'), { name });
    const provider = new SesMailDeliveryProvider(
      { provider: 'ses', fromEmail: 'noreply@example.com', ses: { region: 'us-east-2' } },
      { send: () => Promise.reject(refusal) },
    );

    const attempt = provider.send({
      from: { name: 'Office League', address: 'officeleague@qa.example.com' },
      to: 'member@gmail.com',
      subject: 'League invitation',
      text: 'Plain text body',
      html: '<p>HTML body</p>',
      metadata: { templateKey: 'LEAGUE_MEMBER_INVITE' },
    });

    await expect(attempt).rejects.toBeInstanceOf(expected);
    await expect(attempt).rejects.toMatchObject({ cause: refusal });
    if (expected === MailDeliveryError) {
      await expect(attempt).rejects.not.toBeInstanceOf(MailDeliveryThrottledError);
    }
  });
});

describe('the From header', () => {
  it('quotes a plain display name, escaping its quotes and backslashes', () => {
    expect(formatMailAddress({ name: 'The "A" Team \\ Co', address: 'ateam@qa.example.com' }))
      .toBe('"The \\"A\\" Team \\\\ Co" <ateam@qa.example.com>');
  });

  it('encodes a display name that is not plain ASCII as UTF-8 words of at most 75 characters each', () => {
    const name = 'Liga de Fútbol Ñandú de la Oficina Central';
    const header = formatMailAddress({ name, address: 'liga@qa.example.com' });
    const words = header.replace(' <liga@qa.example.com>', '').split(' ');

    expect(words.every((word) => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(word) && word.length <= 75)).toBe(true);
    expect(words.map((word) => Buffer.from(word.slice(10, -2), 'base64').toString('utf8')).join('')).toBe(name);
  });
});

describe('EMAIL_CONFIG defaults', () => {
  it('sends nothing on QA until a root admin turns email on', () => {
    expect(EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'qa' }).enabled).toBe(false);
  });

  it('sends every email to everyone everywhere else', () => {
    expect(EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' })).toEqual({
      enabled: true,
      allowedRecipients: [],
      sendRatePerSecond: 10,
      entryReminderHours: [48, 24, 3],
      standingsBufferMinutes: 30,
      templates: {
        LEAGUE_MEMBER_INVITE: true,
        LEAGUE_JOIN_SUCCESS: true,
        CONTEST_ENTRY_COMPLETED: true,
        CONTEST_STARTED_SUMMARY: true,
        CONTEST_ENTRY_REMINDER: true,
        CONTEST_OPENED: true,
        CONTEST_STANDINGS: true,
      },
    });
  });

  it('refuses to pick a default when POOLMASTER_ENVIRONMENT is unset, instead of guessing email should be on', () => {
    expect(() => EMAIL_SETTINGS.defaults({ ENVIRONMENT: 'qa' })).toThrow(/POOLMASTER_ENVIRONMENT/);
  });
});

describe('EMAIL_CONFIG send rate', () => {
  it('takes a whole number of emails a second from 1 to 100', () => {
    const base = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'qa' });
    const parses = (sendRatePerSecond: number) => EmailConfigSchema.safeParse({ ...base, sendRatePerSecond }).success;

    expect([1, 14, 100].map(parses)).toEqual([true, true, true]);
    expect([0, 101, 2.5].map(parses)).toEqual([false, false, false]);
  });
});

describe('EMAIL_CONFIG entry reminder hours', () => {
  it('takes one to five whole numbers of hours from 1 to 168 (a week)', () => {
    const base = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'qa' });
    const parses = (entryReminderHours: number[]) => EmailConfigSchema.safeParse({ ...base, entryReminderHours }).success;

    expect([[3], [168, 48, 24, 3, 1]].map(parses)).toEqual([true, true]);
    expect([[], [48, 24, 12, 6, 3, 1], [0], [169], [2.5]].map(parses)).toEqual([false, false, false, false, false]);
  });
});

describe('EMAIL_CONFIG allowed recipients', () => {
  it('stores addresses and @domains lowercased and trimmed, and refuses anything else', () => {
    const base = EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'qa' });

    expect(EmailConfigSchema.parse({ ...base, allowedRecipients: [' Derek@Gmail.com ', '@Simulator.AmazonSES.com'] }).allowedRecipients)
      .toEqual(['derek@gmail.com', '@simulator.amazonses.com']);
    for (const invalid of ['gmail.com', 'derek@', '@', 'two words@gmail.com', '@nodot']) {
      expect(EmailConfigSchema.safeParse({ ...base, allowedRecipients: [invalid] }).success).toBe(false);
    }
  });
});

describe('one-click unsubscribe headers', () => {
  function sesProvider(sentCommands: SendEmailCommand[]) {
    return new SesMailDeliveryProvider(
      { provider: 'ses', fromEmail: 'noreply@example.com', ses: { region: 'us-east-2' } },
      {
        send: (command: SendEmailCommand) => {
          sentCommands.push(command);
          return Promise.resolve({ MessageId: 'ses-message-1', $metadata: {} });
        },
      },
    );
  }

  it('sends List-Unsubscribe and List-Unsubscribe-Post through SES on an email that carries an unsubscribe URL, so mail apps show a one-click Unsubscribe', async () => {
    const sentCommands: SendEmailCommand[] = [];

    await sesProvider(sentCommands).send({
      from: { name: 'Office League', address: 'officeleague@qa.example.com' },
      to: 'member@gmail.com',
      subject: 'Entry submitted',
      text: 'Plain text body',
      html: '<p>HTML body</p>',
      listUnsubscribeUrl: 'https://qa.example.com/api/v1/email/unsubscribe?token=abc',
      metadata: { templateKey: 'CONTEST_ENTRY_COMPLETED' },
    });

    expect(sentCommands[0].input.Content?.Simple?.Headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://qa.example.com/api/v1/email/unsubscribe?token=abc>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ]);
  });

  it('sends no extra headers through SES on an email a member cannot turn off', async () => {
    const sentCommands: SendEmailCommand[] = [];

    await sesProvider(sentCommands).send({
      from: { name: 'Office League', address: 'officeleague@qa.example.com' },
      to: 'member@gmail.com',
      subject: 'League invitation',
      text: 'Plain text body',
      html: '<p>HTML body</p>',
      metadata: { templateKey: 'LEAGUE_MEMBER_INVITE' },
    });

    expect(sentCommands[0].input.Content?.Simple).not.toHaveProperty('Headers');
  });
});
