/**
 * Builds the app's email outbox (#844): the email service that records each email and the
 * sender that sends them, over one transport and one table. index.ts starts the sender; the
 * integration app does not, so what its tests send stays queued.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '@poolmaster/shared/dto';
import { PrismaEmailMessageRepository } from '../../adapters';
import { EmailSender } from './email-sender';
import { EmailService } from './email-service';
import { createMailDeliveryProvider, readMailDeliveryConfig } from './mail-delivery';

export interface EmailOutbox {
  email: EmailService;
  sender: EmailSender;
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
  const sender = new EmailSender({
    messages,
    transport,
    readConfig: options.readConfig,
    logger: options.logger,
  });
  const email = new EmailService({
    messages,
    providerName: transport.providerName,
    readConfig: options.readConfig,
    senderAddress: mailConfig.fromEmail,
    onQueued: () => { sender.wake(); },
    logger: options.logger,
  });
  return { email, sender };
}
