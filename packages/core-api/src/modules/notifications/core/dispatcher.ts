/**
 * NotificationDispatcher — the central orchestration engine.
 *
 * Receives NotificationEvents, resolves recipients, checks preferences,
 * renders templates, and dispatches to the appropriate channels.
 */

import type { PrismaClient } from '@prisma/client';
import type { NotificationEvent, NotificationChannel } from '@poolmaster/shared/events';
import type { Channels } from '../channels/channel-factory';
import { renderTemplate } from './template-renderer';
import { shouldDeliver, getEventCategory, type UserPreferences } from './preference-service';
import type { RateLimiter } from './rate-limiter';

export interface DispatchResult {
  eventId: string;
  eventType: string;
  recipientCount: number;
  deliveries: ChannelDelivery[];
}

export interface ChannelDelivery {
  userId: string;
  channel: NotificationChannel;
  status: 'SENT' | 'SUPPRESSED' | 'FAILED';
  suppressionReason?: string;
  messageId?: string;
  error?: string;
}

/**
 * Default channels per notification category.
 *
 * Hardcoded fallback — at runtime, the ChannelConfigService getter is
 * checked first so admins can tune channel assignments without redeployment.
 */
const HARDCODED_CHANNELS: Record<string, NotificationChannel[]> = {
  DRAFT: ['PUSH', 'EMAIL', 'IN_APP'],
  SCORING: ['PUSH', 'IN_APP'],
  CONTEST: ['PUSH', 'EMAIL', 'IN_APP'],
  LEAGUE: ['IN_APP'],
  SOCIAL: ['PUSH', 'IN_APP'],
  ACCOUNT: ['EMAIL', 'IN_APP'],
};

/**
 * Returns the current default channels, preferring admin-configured values
 * when available and falling back to hardcoded defaults otherwise.
 */
function getDefaultChannels(): Record<string, NotificationChannel[]> {
  try {
    // Dynamic import avoids hard coupling — the admin module may not be loaded
    // in all deployment contexts (e.g. standalone notification worker).
     
    const { getChannelDefaults } = require('../../../core-api/src/modules/admin/channel-config-service');
    const configured = getChannelDefaults();
    if (configured && Object.keys(configured).length > 0) {
      return configured as Record<string, NotificationChannel[]>;
    }
  } catch {
    // Admin module not available — fall through to hardcoded defaults
  }
  return HARDCODED_CHANNELS;
}

export class NotificationDispatcher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly channels: Channels,
    private readonly rateLimiter?: RateLimiter,
  ) {}

  /** Dispatches a notification event to all recipients across all channels. */
  async dispatch(event: NotificationEvent): Promise<DispatchResult> {
    const recipients = await this.resolveRecipients(event);
    const template = await this.getTemplate(event.type);
    const deliveries: ChannelDelivery[] = [];

    const defaults = getDefaultChannels();
    const channelsToUse = event.channels ?? defaults[getEventCategory(event.type)] ?? ['IN_APP'];

    for (const userId of recipients) {
      const prefs = await this.getUserPreferences(userId);
      const user = await this.prisma.user.findUnique({ where: { id: userId } });

      for (const channel of channelsToUse) {
        // Check preferences
        if (!shouldDeliver(event.type, channel, prefs)) {
          deliveries.push({ userId, channel, status: 'SUPPRESSED', suppressionReason: 'USER_PREFERENCE' });
          continue;
        }

        // Check rate limit
        if (this.rateLimiter) {
          const allowed = await this.rateLimiter.check(userId, channel, event.type);
          if (!allowed) {
            deliveries.push({ userId, channel, status: 'SUPPRESSED', suppressionReason: 'RATE_LIMITED' });
            continue;
          }
        }

        // Render and send
        try {
          const delivery = await this.sendToChannel(channel, userId, user?.email, event, template);
          deliveries.push(delivery);

          // Record rate limit usage
          if (this.rateLimiter) {
            await this.rateLimiter.record(userId, channel, event.type);
          }
        } catch (err) {
          deliveries.push({
            userId,
            channel,
            status: 'FAILED',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Log deliveries
    await this.logDeliveries(event, deliveries);

    return {
      eventId: event.id,
      eventType: event.type,
      recipientCount: recipients.length,
      deliveries,
    };
  }

  private async resolveRecipients(event: NotificationEvent): Promise<string[]> {
    if (event.recipientUserIds && event.recipientUserIds.length > 0) {
      return event.recipientUserIds;
    }

    switch (event.recipientScope) {
      case 'ALL_LEAGUE': {
        if (!event.leagueId) return [];
        const memberships = await this.prisma.leagueMembership.findMany({
          where: { leagueId: event.leagueId },
          select: { userId: true },
        });
        return memberships.map((m: { userId: string }) => m.userId);
      }
      case 'ALL_CONTEST': {
        if (!event.contestId) return [];
        const entries = await this.prisma.contestEntry.findMany({
          where: { contestId: event.contestId },
          include: { membership: { select: { userId: true } } },
        });
        return entries.map((e: { membership: { userId: string } }) => e.membership.userId);
      }
      case 'COMMISSIONERS': {
        if (!event.leagueId) return [];
        const commissioners = await this.prisma.leagueMembership.findMany({
          where: { leagueId: event.leagueId, role: { in: ['OWNER', 'COMMISSIONER'] } },
          select: { userId: true },
        });
        return commissioners.map((c: { userId: string }) => c.userId);
      }
      default:
        return [];
    }
  }

  private async getTemplate(eventType: string) {
    return this.prisma.notificationTemplate.findFirst({
      where: { eventType, active: true },
      orderBy: { version: 'desc' },
    });
  }

  private async getUserPreferences(userId: string): Promise<UserPreferences | undefined> {
    const prefs = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    if (!prefs) return undefined;
    return {
      doNotDisturb: prefs.doNotDisturb,
      dndSchedule: prefs.dndSchedule as UserPreferences['dndSchedule'],
      categories: prefs.categoryPreferences as unknown as Record<string, UserPreferences['categories'][string]>,
    };
  }

  private async sendToChannel(
    channel: NotificationChannel,
    userId: string,
    userEmail: string | undefined,
    event: NotificationEvent,
    template: {
      pushTitle: string | null;
      pushBody: string | null;
      emailSubject: string | null;
      emailHtml: string | null;
      emailText: string | null;
      inAppTitle: string | null;
      inAppBody: string | null;
      inAppIcon: string | null;
    } | null,
  ): Promise<ChannelDelivery> {
    const data = event.data as Record<string, unknown>;

    switch (channel) {
      case 'IN_APP': {
        const title = template?.inAppTitle ? renderTemplate(template.inAppTitle, data) : event.type;
        const body = template?.inAppBody ? renderTemplate(template.inAppBody, data) : '';
        const id = await this.channels.inApp.send({
          userId,
          eventType: event.type,
          title,
          body,
          actionScreen: event.action?.screen,
          actionParams: event.action?.params,
          groupKey: event.collapseKey,
        });
        return { userId, channel: 'IN_APP', status: 'SENT', messageId: id };
      }

      case 'PUSH': {
        const title = template?.pushTitle ? renderTemplate(template.pushTitle, data) : event.type;
        const body = template?.pushBody ? renderTemplate(template.pushBody, data) : '';
        const results = await this.channels.push.sendToUser(userId, {
          title,
          body,
          data: event.action?.params,
        });
        const firstResult = results[0];
        if (!firstResult) {
          return { userId, channel: 'PUSH', status: 'SUPPRESSED', suppressionReason: 'NO_DEVICES' };
        }
        return {
          userId,
          channel: 'PUSH',
          status: firstResult.success ? 'SENT' : 'FAILED',
          messageId: firstResult.messageId,
          error: firstResult.error,
        };
      }

      case 'EMAIL': {
        if (!userEmail) {
          return { userId, channel: 'EMAIL', status: 'SUPPRESSED', suppressionReason: 'NO_EMAIL' };
        }
        const subject = template?.emailSubject ? renderTemplate(template.emailSubject, data) : event.type;
        const text = template?.emailText ? renderTemplate(template.emailText, data) : '';
        const html = template?.emailHtml ? renderTemplate(template.emailHtml, data) : undefined;
        const result = await this.channels.email.sendToUser(userEmail, subject, text, html);
        return {
          userId,
          channel: 'EMAIL',
          status: result.success ? 'SENT' : 'FAILED',
          messageId: result.messageId,
          error: result.error,
        };
      }

      case 'SMS':
        // SMS deferred to 09-028
        return { userId, channel: 'SMS', status: 'SUPPRESSED', suppressionReason: 'CHANNEL_NOT_IMPLEMENTED' };

      default:
        return { userId, channel, status: 'FAILED', error: `Unknown channel: ${channel}` };
    }
  }

  private async logDeliveries(event: NotificationEvent, deliveries: ChannelDelivery[]): Promise<void> {
    try {
      await this.prisma.notificationDeliveryLog.createMany({
        data: deliveries.map((d) => ({
          notificationEventId: event.id,
          userId: d.userId,
          channel: d.channel,
          status: d.status,
          suppressionReason: d.suppressionReason,
          providerMessageId: d.messageId,
          failedReason: d.error,
          sentAt: d.status === 'SENT' ? new Date() : undefined,
        })),
      });
    } catch {
      // Don't fail the dispatch if logging fails
    }
  }
}
