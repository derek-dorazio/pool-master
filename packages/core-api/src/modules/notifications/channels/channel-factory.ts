/**
 * ChannelFactory — constructs the correct channel implementations based on config.
 *
 * In dev: SMTP → Mailpit, Push → push-mock-server, SES → LocalStack
 * In prod: SES → real AWS, Push → real APNs/FCM
 */

import type { PrismaClient } from '@prisma/client';
import type { NotificationConfig } from '../core/config';
import { InAppChannel } from './in-app-channel';
import { EmailChannel, SmtpEmailProvider, SesEmailProvider, type EmailProvider } from './email-channel';
import { PushChannel, ApnsPushProvider, FcmPushProvider } from './push-channel';

export interface Channels {
  inApp: InAppChannel;
  email: EmailChannel;
  push: PushChannel;
}

export function createChannels(config: NotificationConfig, prisma: PrismaClient): Channels {
  // In-app — always Prisma-backed
  const inApp = new InAppChannel(prisma);

  // Email — SMTP (Mailpit) or SES (LocalStack/real)
  let emailProvider: EmailProvider;
  if (config.emailProvider === 'smtp') {
    emailProvider = new SmtpEmailProvider({
      host: config.smtpHost,
      port: config.smtpPort,
    });
  } else {
    emailProvider = new SesEmailProvider({
      endpoint: config.awsEndpoint,
      region: config.awsRegion,
    });
  }
  const email = new EmailChannel(emailProvider, config.smtpFrom);

  // Push — configurable base URLs (push-mock in dev, real in prod)
  const apns = new ApnsPushProvider({
    baseUrl: config.apnsBaseUrl,
    keyId: config.apnsKeyId,
    teamId: config.apnsTeamId,
    bundleId: config.apnsBundleId,
  });
  const fcm = new FcmPushProvider({
    baseUrl: config.fcmBaseUrl,
    projectId: config.fcmProjectId,
  });
  const push = new PushChannel({ apns, fcm }, prisma);

  return { inApp, email, push };
}
