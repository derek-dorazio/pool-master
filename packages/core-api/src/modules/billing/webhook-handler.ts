/**
 * Stripe webhook handler.
 *
 * The repository does not currently wire a real Stripe provider, so webhook
 * processing is explicitly unavailable instead of simulating event handling.
 */

import type { FastifyInstance } from 'fastify';
import { isBillingEnabled } from './billing-feature-gate';

export async function webhookModule(fastify: FastifyInstance): Promise<void> {
  fastify.post('/internal/webhooks/stripe', async (_request, reply) => {
    const billingOn = await isBillingEnabled();
    if (!billingOn) {
      return reply.status(200).send({ received: true, processed: false, reason: 'billing_disabled' });
    }

    return reply.status(501).send({
      error: 'BILLING_WEBHOOK_UNAVAILABLE',
      message: 'Stripe webhook processing is unavailable until a real provider integration exists.',
    });
  });
}
