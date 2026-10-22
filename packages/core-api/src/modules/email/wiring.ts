/**
 * Builds the app's email outbox (#844): the email service that records each email and the
 * sender that sends them, over one transport and one table. index.ts starts the sender's timer;
 * the integration app starts none, but a queued email still wakes the sender, so it is sent.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '@poolmaster/shared/dto';
import { PrismaEmailMessageRepository, PrismaEmailSuppressionRepository } from '../../adapters';
import { EmailDeliveryEvents } from './email-delivery-events';
import { EmailSender } from './email-sender';
import { EmailService } from './email-service';
import { createMailDeliveryProvider, readMailDeliveryConfig } from './mail-delivery';

export interface EmailOutbox {
  email: EmailService;
  sender: EmailSender;
  /** Records what SES reports after it accepts an email. */
  deliveryEvents: EmailDeliveryEvents;
}

export function createEmailOutbox(options: {
  prisma: PrismaClient;
  readConfig: () => EmailConfig;
  env?: NodeJS.ProcessEnv;
  logger?: FastifyBaseLogger;
}): EmailOutbox {
  const mailConfig = readMailDeliveryConfig(options.env);
  const transport = createMailDeliveryProvider(mailConfig, options.logger);
  const messages = new PrismaEmailMessageRepository(options.prisma);
  const suppressions = new PrismaEmailSuppressionRepository(options.prisma);
  const sender = new EmailSender({
    messages,
    transport,
    readConfig: options.readConfig,
    logger: options.logger,
  });
  const email = new EmailService({
    messages,
    suppressions,
    providerName: transport.providerName,
    readConfig: options.readConfig,
    senderAddress: mailConfig.fromEmail,
    onQueued: () => { sender.wake(); },
    logger: options.logger,
  });
  const deliveryEvents = new EmailDeliveryEvents({ messages, suppressions, logger: options.logger });
  return { email, sender, deliveryEvents };
}
