/**
 * Stripe webhook handler — processes incoming Stripe events.
 *
 * POST /api/v1/internal/webhooks/stripe
 *
 * All handlers use in-memory state since the Stripe client is mocked.
 * In production, each handler would update Prisma records.
 */

import type { FastifyInstance } from 'fastify';
import { isBillingEnabled } from './billing-feature-gate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

interface WebhookLog {
  eventId: string;
  eventType: string;
  processedAt: Date;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// In-memory event log
// ---------------------------------------------------------------------------

const processedEvents: WebhookLog[] = [];

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleSubscriptionCreated(data: Record<string, unknown>): Promise<void> {
  const customerId = data.customer as string;
  const status = data.status as string;
  console.log(`[webhook] subscription.created — customer=${customerId} status=${status}`);
}

async function handleSubscriptionUpdated(data: Record<string, unknown>): Promise<void> {
  const subId = data.id as string;
  const status = data.status as string;
  console.log(`[webhook] subscription.updated — sub=${subId} status=${status}`);
}

async function handleSubscriptionDeleted(data: Record<string, unknown>): Promise<void> {
  const subId = data.id as string;
  console.log(`[webhook] subscription.deleted — sub=${subId}`);
}

async function handleTrialWillEnd(data: Record<string, unknown>): Promise<void> {
  const subId = data.id as string;
  const trialEnd = data.trial_end as number;
  console.log(`[webhook] trial_will_end — sub=${subId} ends=${new Date(trialEnd * 1000).toISOString()}`);
}

async function handlePaymentSucceeded(data: Record<string, unknown>): Promise<void> {
  const invoiceId = data.id as string;
  const amountPaid = data.amount_paid as number;
  console.log(`[webhook] payment_succeeded — invoice=${invoiceId} amount=${amountPaid}`);
}

async function handlePaymentFailed(data: Record<string, unknown>): Promise<void> {
  const invoiceId = data.id as string;
  const amountDue = data.amount_due as number;
  console.log(`[webhook] payment_failed — invoice=${invoiceId} amount=${amountDue}`);
}

// ---------------------------------------------------------------------------
// Event router
// ---------------------------------------------------------------------------

const EVENT_HANDLERS: Record<string, (data: Record<string, unknown>) => Promise<void>> = {
  'customer.subscription.created': handleSubscriptionCreated,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'customer.subscription.trial_will_end': handleTrialWillEnd,
  'invoice.payment_succeeded': handlePaymentSucceeded,
  'invoice.payment_failed': handlePaymentFailed,
};

// ---------------------------------------------------------------------------
// Fastify route registration
// ---------------------------------------------------------------------------

/**
 * Registers the Stripe webhook endpoint.
 */
export async function webhookModule(fastify: FastifyInstance): Promise<void> {
  fastify.post('/internal/webhooks/stripe', async (request, reply) => {
    const billingOn = await isBillingEnabled();
    if (!billingOn) {
      return reply.status(200).send({ received: true, processed: false, reason: 'billing_disabled' });
    }
    const event = request.body as StripeEvent;
    if (!event || !event.type || !event.id) {
      return reply.status(400).send({ error: 'INVALID_EVENT' });
    }
    // Idempotency check
    const alreadyProcessed = processedEvents.some((e) => e.eventId === event.id);
    if (alreadyProcessed) {
      return reply.status(200).send({ received: true, processed: false, reason: 'duplicate' });
    }
    const handler = EVENT_HANDLERS[event.type];
    if (!handler) {
      processedEvents.push({
        eventId: event.id,
        eventType: event.type,
        processedAt: new Date(),
        success: true,
      });
      return reply.status(200).send({ received: true, processed: false, reason: 'unhandled_event' });
    }
    try {
      await handler(event.data.object);
      processedEvents.push({
        eventId: event.id,
        eventType: event.type,
        processedAt: new Date(),
        success: true,
      });
      return reply.status(200).send({ received: true, processed: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      processedEvents.push({
        eventId: event.id,
        eventType: event.type,
        processedAt: new Date(),
        success: false,
        error: message,
      });
      return reply.status(500).send({ error: 'WEBHOOK_PROCESSING_FAILED', message });
    }
  });
}
