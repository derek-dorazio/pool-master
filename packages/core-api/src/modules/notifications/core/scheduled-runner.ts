/**
 * ScheduledRunner — fires scheduled notifications when their time arrives.
 *
 * Polls the scheduled_notifications table periodically and dispatches
 * events that are due. Uses simple polling rather than BullMQ for now
 * (BullMQ can be swapped in when Redis-based job queues are needed).
 */

import type { PrismaClient } from '@prisma/client';
import type { NotificationDispatcher } from './dispatcher';
import type { NotificationEvent } from '@poolmaster/shared/events';
import crypto from 'node:crypto';

export class ScheduledRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly dispatcher: NotificationDispatcher,
    private readonly pollIntervalMs = 30_000,
  ) {}

  /** Starts the polling loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll(); // immediate first poll
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  /** Stops the polling loop. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Schedules a future notification. */
  async schedule(params: {
    eventType: string;
    fireAt: Date;
    context: Record<string, unknown>;
    sourceType: string;
    sourceId: string;
  }): Promise<string> {
    const scheduled = await this.prisma.scheduledNotification.create({
      data: {
        eventType: params.eventType,
        fireAt: params.fireAt,
        context: params.context as object,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        status: 'PENDING',
      },
    });
    return scheduled.id;
  }

  /** Cancels all pending notifications for a source (e.g., when a contest is cancelled). */
  async cancelForSource(sourceType: string, sourceId: string): Promise<number> {
    const result = await this.prisma.scheduledNotification.updateMany({
      where: { sourceType, sourceId, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledReason: 'SOURCE_CANCELLED' },
    });
    return result.count;
  }

  /** Polls for due notifications and fires them. */
  private async poll(): Promise<void> {
    try {
      const now = new Date();

      const due = await this.prisma.scheduledNotification.findMany({
        where: {
          status: 'PENDING',
          fireAt: { lte: now },
        },
        orderBy: { fireAt: 'asc' },
        take: 50,
      });

      for (const scheduled of due) {
        try {
          const context = scheduled.context as Record<string, unknown>;

          // Build a NotificationEvent from the scheduled context
          const event: NotificationEvent = {
            id: crypto.randomUUID(),
            type: scheduled.eventType,
            sourceService: 'scheduled-runner',
            timestamp: now.toISOString(),
            tenantId: (context.tenantId as string) ?? '',
            leagueId: context.leagueId as string | undefined,
            contestId: context.contestId as string | undefined,
            recipientUserIds: context.recipientUserIds as string[] | undefined,
            recipientScope: context.recipientScope as NotificationEvent['recipientScope'],
            data: context.data as Record<string, unknown> ?? context,
            priority: (context.priority as NotificationEvent['priority']) ?? 'NORMAL',
            action: (context.action as NotificationEvent['action']) ?? {
              type: 'NAVIGATE',
              screen: 'home',
              params: {},
            },
          };

          await this.dispatcher.dispatch(event);

          await this.prisma.scheduledNotification.update({
            where: { id: scheduled.id },
            data: { status: 'FIRED', firedAt: now },
          });
        } catch {
          // Individual failures don't stop the batch
          await this.prisma.scheduledNotification.update({
            where: { id: scheduled.id },
            data: { status: 'CANCELLED', cancelledReason: 'DISPATCH_FAILED' },
          });
        }
      }
    } catch {
      // Poll failures are transient — next poll will retry
    }
  }
}
