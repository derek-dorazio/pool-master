import { type SendEmailCommand } from '@aws-sdk/client-ses';
import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  EMAIL_SETTINGS,
  MailDeliveryConfigError,
  SesMailDeliveryProvider,
  SettingsAwareMailDeliveryProvider,
  type MailDeliveryMessage,
  type MailDeliveryProvider,
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
  it('submits rendered subject, text, and HTML to SES without logging message content', async () => {
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
      to: 'member@example.com',
      subject: 'League invitation',
      text: 'Plain text body',
      html: '<p>HTML body</p>',
      replyTo: 'reply@example.com',
      metadata: {
        templateKey: 'LEAGUE_MEMBER_INVITE',
        leagueId: 'league-1',
        invitationId: 'invite-1',
      },
    });

    expect(result).toEqual({ provider: 'ses', messageId: 'ses-message-1' });
    expect(sentCommands).toHaveLength(1);
    expect(sentCommands[0].input).toEqual({
      Source: 'noreply@example.com',
      Destination: { ToAddresses: ['member@example.com'] },
      ReplyToAddresses: ['reply@example.com'],
      ConfigurationSetName: 'poolmaster-qa',
      Message: {
        Subject: { Data: 'League invitation', Charset: 'UTF-8' },
        Body: {
          Text: { Data: 'Plain text body', Charset: 'UTF-8' },
          Html: { Data: '<p>HTML body</p>', Charset: 'UTF-8' },
        },
      },
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('Plain text body');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('HTML body');
  });
});

const INVITE: MailDeliveryMessage = {
  to: ['member@example.com', 'second@example.com'],
  subject: 'League invitation',
  text: 'Plain text body',
  html: '<p>HTML body</p>',
  metadata: {
    templateKey: 'LEAGUE_MEMBER_INVITE',
    leagueId: 'league-1',
    invitationId: 'invite-1',
  },
};

function recordingTransport(): MailDeliveryProvider & { sent: MailDeliveryMessage[] } {
  const sent: MailDeliveryMessage[] = [];
  return {
    providerName: 'smtp',
    sent,
    send: (message) => {
      sent.push(message);
      return Promise.resolve({ provider: 'smtp', messageId: `message-${sent.length}` });
    },
  };
}

function emailConfig(overrides: Partial<EmailConfig> = {}): EmailConfig {
  return { ...EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }), ...overrides };
}

describe('EMAIL_CONFIG defaults', () => {
  it('sends nothing on QA until real delivery is set up', () => {
    expect(EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'qa' }).enabled).toBe(false);
  });

  it('sends every email, with no Reply-To, everywhere else', () => {
    expect(EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' })).toEqual({
      enabled: true,
      replyTo: null,
      templates: {
        LEAGUE_MEMBER_INVITE: true,
        LEAGUE_JOIN_SUCCESS: true,
        CONTEST_ENTRY_COMPLETED: true,
        CONTEST_STARTED_SUMMARY: true,
      },
    });
  });

  it('refuses to pick a default when POOLMASTER_ENVIRONMENT is unset, instead of guessing email should be on', () => {
    expect(() => EMAIL_SETTINGS.defaults({ ENVIRONMENT: 'qa' })).toThrow(/POOLMASTER_ENVIRONMENT/);
  });
});

describe('settings-aware mail delivery', () => {
  it('with email switched off, reports success without sending and logs the skip with ids but no content or address', async () => {
    const transport = recordingTransport();
    const logger = fakeLogger();
    const provider = new SettingsAwareMailDeliveryProvider(transport, () => emailConfig({ enabled: false }), logger);

    const result = await provider.send(INVITE);

    expect(result).toEqual({ provider: 'smtp', skipped: 'emailDisabled' });
    expect(transport.sent).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      {
        action: 'mailDelivery.skip',
        data: {
          reason: 'emailDisabled',
          toCount: 2,
          templateKey: 'LEAGUE_MEMBER_INVITE',
          leagueId: 'league-1',
          contestId: null,
          entryId: null,
          invitationId: 'invite-1',
        },
      },
      expect.any(String),
    );
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('Plain text body');
    expect(logged).not.toContain('member@example.com');
  });

  it('skips only the template switched off and still sends the others', async () => {
    const transport = recordingTransport();
    const config = emailConfig();
    const provider = new SettingsAwareMailDeliveryProvider(transport, () => ({
      ...config,
      templates: { ...config.templates, LEAGUE_MEMBER_INVITE: false },
    }));

    const skipped = await provider.send(INVITE);
    await provider.send({ ...INVITE, metadata: { templateKey: 'LEAGUE_JOIN_SUCCESS' } });

    expect(skipped.skipped).toBe('templateDisabled');
    expect(transport.sent.map((message) => message.metadata?.templateKey)).toEqual(['LEAGUE_JOIN_SUCCESS']);
  });

  it('reads the setting on every send, so a change applies to the next email without a restart', async () => {
    const transport = recordingTransport();
    let config = emailConfig({ enabled: false });
    const provider = new SettingsAwareMailDeliveryProvider(transport, () => config);

    await provider.send(INVITE);
    config = emailConfig({ enabled: true });
    await provider.send(INVITE);

    expect(transport.sent).toHaveLength(1);
  });

  it('adds the configured Reply-To, unless the message names its own', async () => {
    const transport = recordingTransport();
    const provider = new SettingsAwareMailDeliveryProvider(transport, () => emailConfig({ replyTo: 'support@example.com' }));

    await provider.send(INVITE);
    await provider.send({ ...INVITE, replyTo: 'commissioner@example.com' });

    expect(transport.sent.map((message) => message.replyTo)).toEqual(['support@example.com', 'commissioner@example.com']);
  });

  it('sends with no Reply-To when none is configured', async () => {
    const transport = recordingTransport();
    const provider = new SettingsAwareMailDeliveryProvider(transport, () => emailConfig());

    await provider.send(INVITE);

    expect(transport.sent[0].replyTo).toBeUndefined();
  });
});
