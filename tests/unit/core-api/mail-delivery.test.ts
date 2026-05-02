import { SendEmailCommand } from '@aws-sdk/client-ses';
import {
  MailDeliveryConfigError,
  SesMailDeliveryProvider,
  readApplicationBaseUrl,
  readMailDeliveryConfig,
} from '../../../packages/core-api/src/modules/email';

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
      replyToEmail: undefined,
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
      EMAIL_REPLY_TO: 'support@example.com',
    });

    expect(config).toEqual({
      provider: 'ses',
      fromEmail: 'noreply@example.com',
      replyToEmail: 'support@example.com',
      ses: {
        region: 'us-east-2',
        endpoint: 'http://localhost:4566',
        configurationSetName: 'poolmaster-qa',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
    });
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
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    } as any;
    const provider = new SesMailDeliveryProvider(
      {
        provider: 'ses',
        fromEmail: 'noreply@example.com',
        replyToEmail: 'reply@example.com',
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
