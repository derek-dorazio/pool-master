import {
  EMAIL_SETTINGS,
  EmailService,
  type MailDeliveryProvider,
} from '../../packages/core-api/src/modules/email';

/**
 * The real EmailService over a test transport, with EMAIL_CONFIG at its everywhere-but-QA
 * defaults (every email on, no allow list), so a test asserts on what reaches the transport.
 */
export function emailServiceOver(transport: MailDeliveryProvider): EmailService {
  return new EmailService({
    transport,
    readConfig: () => EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }),
    senderAddress: 'noreply@poolmaster.test',
  });
}
