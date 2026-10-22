/**
 * Builds the app's email outbox (#844): the email service that records each email and the
 * sender that sends them, over one transport and one table. index.ts starts the sender's timer;
 * the integration app starts none, but a queued email still wakes the sender, so it is sent.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '@poolmaster/shared/dto';
import {
  PrismaEmailMessageRepository,
  PrismaEmailOptOutRepository,
  PrismaEmailSuppressionRepository,
  PrismaUserRepository,
} from '../../adapters';
import { readJwtSecret } from '../../core/config';
import { EmailDeliveryEvents } from './email-delivery-events';
import { EmailPreferencesService } from './email-preferences-service';
import { EmailSender } from './email-sender';
import { EmailService } from './email-service';
import { createMailDeliveryProvider, readApplicationBaseUrl, readMailDeliveryConfig } from './mail-delivery';
import { UnsubscribeTokens } from './unsubscribe-tokens';

export interface EmailOutbox {
  email: EmailService;
  sender: EmailSender;
  /** Records what SES reports after it accepts an email. */
  deliveryEvents: EmailDeliveryEvents;
  /** Which categories of email each user gets, and the unsubscribe their links lead to. */
  preferences: EmailPreferencesService;
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
  const optOuts = new PrismaEmailOptOutRepository(options.prisma);
  const unsubscribeTokens = new UnsubscribeTokens(readJwtSecret());
  const sender = new EmailSender({
    messages,
    transport,
    readConfig: options.readConfig,
    logger: options.logger,
  });
  const email = new EmailService({
    messages,
    suppressions,
    optOuts,
    unsubscribe: { tokens: unsubscribeTokens, appBaseUrl: readApplicationBaseUrl(options.env) },
    providerName: transport.providerName,
    readConfig: options.readConfig,
    senderAddress: mailConfig.fromEmail,
    onQueued: () => { sender.wake(); },
    logger: options.logger,
  });
  const deliveryEvents = new EmailDeliveryEvents({ messages, suppressions, logger: options.logger });
  const preferences = new EmailPreferencesService({
    users: new PrismaUserRepository(options.prisma),
    optOuts,
    suppressions,
    tokens: unsubscribeTokens,
    logger: options.logger,
  });
  return { email, sender, deliveryEvents, preferences };
}
