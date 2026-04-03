/**
 * Billing module — plan tier, entitlement, usage, self-service portal,
 * dunning, revenue analytics, and enterprise plan routes.
 *
 * Routes:
 *   GET  /plan                              → Current plan details for tenant
 *   GET  /entitlements                      → All entitlement checks for current tenant
 *   GET  /usage                             → Usage summary (leagues, members, contests)
 *   GET  /plans                             → Available plan tiers (public tiers only)
 *   POST /subscribe                         → Create subscription (gated)
 *   PUT  /plan                              → Change plan (gated)
 *   POST /resume                            → Resume subscription (gated)
 *   GET  /subscription                      → Current subscription details
 *   POST /payment-method                    → Setup intent for Stripe Elements
 *   GET  /portal                            → Stripe billing portal session URL
 *   POST /trial/start                       → Start trial (gated)
 *   GET  /trial/status                      → Trial status
 *   GET  /invoices                          → Invoice history for tenant
 *   GET  /invoices/upcoming                 → Upcoming invoice preview
 *   GET  /invoices/:invoiceId               → Invoice detail
 *   GET  /upgrade-preview/:planSlug         → Preview upgrade proration
 *   GET  /downgrade-preview/:planSlug       → Preview downgrade impact
 *   GET  /cancellation-preview              → Preview cancellation
 *   GET  /retention-offer                   → Get retention offer
 *   POST /cancel                            → Cancel with feedback (gated)
 *   GET  /analytics                         → Revenue metrics (admin)
 *   GET  /analytics/subscribers             → Subscribers by plan (admin)
 *   GET  /analytics/trials                  → Trial metrics (admin)
 *   GET  /analytics/churn                   → Churn metrics (admin)
 *   GET  /enterprise                        → List enterprise plans (admin)
 *   POST /enterprise                        → Create enterprise plan (admin)
 *   GET  /dunning/:tenantId                 → Dunning status (admin)
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import type { EntitlementKey } from '@poolmaster/shared/domain';
import { z } from 'zod';
import {
  zodToJsonSchema,
} from '@poolmaster/shared/dto/json-schema';
import {
  ApiErrorSchema,
  SuccessSchema,
} from '@poolmaster/shared/dto/common.dto';
import {
  PlanResponseSchema,
  PlansListResponseSchema,
  UsageResponseSchema,
  EntitlementsResponseSchema,
  SubscriptionResponseSchema,
  InvoiceListResponseSchema,
  UpcomingInvoiceResponseSchema,
  InvoiceDetailResponseSchema,
  PaymentMethodSetupResponseSchema,
  BillingPortalResponseSchema,
} from '@poolmaster/shared/dto';
import { EntitlementService } from './entitlement-service';
import { UsageService } from './usage-service';
import { SubscriptionService } from './subscription-service';
import { TrialService } from './trial-service';
import { PlanChangeService } from './plan-change-service';
import { CancellationService } from './cancellation-service';
import {
  InvoicePersistenceUnavailableError,
  InvoiceService,
} from './invoice-service';
import { DunningService } from './dunning-service';
import { RevenueAnalyticsService } from './revenue-analytics-service';
import { EnterprisePlanUnavailableError, EnterpriseService } from './enterprise-service';
import { isBillingEnabled } from './billing-feature-gate';
import { BillingProviderUnavailableError, stripeClient } from './stripe-service';

const ALL_ENTITLEMENT_KEYS: EntitlementKey[] = [
  'league.create',
  'league.member.add',
  'contest.create',
  'sport.access',
  'draft.type',
  'draft.mode',
  'leaderboard.realtime',
  'scoring.custom',
  'history.access',
  'analytics.access',
  'branding.custom',
  'prizes.intermediate',
  'api.access',
];

const DunningStatusSchema = z.object({
  tenantId: z.string(),
  phase: z.enum(['NONE', 'GRACE', 'DEGRADED', 'PENDING_CANCEL', 'CANCELLED']),
  failedAt: z.string().datetime().nullable(),
  retryCount: z.number(),
  nextRetryAt: z.string().datetime().nullable(),
  gracePeriodEndsAt: z.string().datetime().nullable(),
  degradedPeriodEndsAt: z.string().datetime().nullable(),
  cancellationAt: z.string().datetime().nullable(),
});

function sendWithStatus(reply: FastifyReply, statusCode: number, payload: unknown) {
  return reply.status(statusCode).send(payload);
}

function sendBillingProviderUnavailable(reply: FastifyReply, message: string) {
  return sendWithStatus(reply, 501, {
    error: 'BILLING_PROVIDER_UNAVAILABLE',
    message,
  });
}

export async function billingModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const usageService = new UsageService(prisma);
  const entitlementService = new EntitlementService(prisma, usageService);
  const subscriptionService = new SubscriptionService(prisma);
  const trialService = new TrialService(prisma);
  const planChangeService = new PlanChangeService(prisma);
  const cancellationService = new CancellationService(prisma);
  const invoiceService = new InvoiceService(prisma);
  const dunningService = new DunningService(prisma);
  const revenueAnalyticsService = new RevenueAnalyticsService(prisma);
  const enterpriseService = new EnterpriseService();

  // -------------------------------------------------------------------------
  // GET /plan — Current plan details for tenant
  // -------------------------------------------------------------------------

  fastify.get('/plan', {
    schema: {
      tags: ['Billing'],
      summary: 'Get current plan details for tenant',
      operationId: 'getCurrentPlan',
      response: { 200: zodToJsonSchema(PlanResponseSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { planTier: true },
      });

      if (!tenant) {
        return sendWithStatus(reply, 404, { error: 'TENANT_NOT_FOUND' });
      }

      const tier = await prisma.planTier.findUnique({
        where: { slug: tenant.planTier },
      });

      if (!tier) {
        return reply.send({
          slug: tenant.planTier,
          name: tenant.planTier,
          entitlements: {},
        });
      }

      return reply.send({
        slug: tier.slug,
        name: tier.name,
        monthlyPriceCents: tier.monthlyPriceCents,
        annualPriceCents: tier.annualPriceCents,
        entitlements: tier.entitlements,
      });
    },
  });

  // -------------------------------------------------------------------------
  // GET /entitlements — All entitlement checks for current tenant
  // -------------------------------------------------------------------------

  fastify.get('/entitlements', {
    schema: {
      tags: ['Billing'],
      summary: 'Get all entitlement checks for current tenant',
      operationId: 'getEntitlements',
      response: { 200: zodToJsonSchema(EntitlementsResponseSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }

      const results = await entitlementService.checkMultiple(tenantId, ALL_ENTITLEMENT_KEYS);

      const entitlements: Record<string, unknown> = {};
      for (const [key, result] of results) {
        entitlements[key] = result;
      }

      return reply.send({ entitlements });
    },
  });

  // -------------------------------------------------------------------------
  // GET /usage — Usage summary (leagues, members, contests)
  // -------------------------------------------------------------------------

  fastify.get('/usage', {
    schema: {
      tags: ['Billing'],
      summary: 'Get usage summary for current tenant',
      operationId: 'getUsage',
      response: { 200: zodToJsonSchema(UsageResponseSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }

      const [leagues, members, contests] = await Promise.all([
        entitlementService.getUsage(tenantId, 'LEAGUES'),
        entitlementService.getUsage(tenantId, 'MEMBERS'),
        entitlementService.getUsage(tenantId, 'CONTESTS'),
      ]);

      return reply.send({ usage: { leagues, members, contests } });
    },
  });

  // -------------------------------------------------------------------------
  // GET /plans — Available plan tiers (public tiers only)
  // -------------------------------------------------------------------------

  fastify.get('/plans', {
    schema: {
      tags: ['Billing'],
      summary: 'List available plan tiers',
      operationId: 'listPlans',
      response: { 200: zodToJsonSchema(PlansListResponseSchema) },
    },
    handler: async (_request, reply) => {
      const billingOn = await isBillingEnabled();
      const tiers = await prisma.planTier.findMany({
        where: { isPublic: true },
        orderBy: { displayOrder: 'asc' },
        select: {
          slug: true,
          name: true,
          displayOrder: true,
          monthlyPriceCents: true,
          annualPriceCents: true,
          trialDays: true,
          entitlements: true,
        },
      });
      return reply.send({
        plans: tiers,
        billingEnabled: billingOn,
        upgradeLabel: billingOn ? 'Upgrade' : 'Coming Soon',
      });
    },
  });

  // -------------------------------------------------------------------------
  // POST /subscribe — Create subscription (gated)
  // -------------------------------------------------------------------------

  fastify.post('/subscribe', {
    schema: {
      tags: ['Billing'],
      summary: 'Create a new subscription',
      operationId: 'createSubscription',
      response: {
        201: zodToJsonSchema(SubscriptionResponseSchema),
        501: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const billingOn = await isBillingEnabled(tenantId);
      if (!billingOn) {
        return sendWithStatus(reply, 403, {
          error: 'BILLING_DISABLED',
          message: 'Billing features are not yet available.',
        });
      }
      const { planSlug, cycle } = request.body as { planSlug: string; cycle: 'MONTHLY' | 'ANNUAL' };
      if (!planSlug || !cycle) {
        return sendWithStatus(reply, 400, { error: 'INVALID_INPUT', message: 'planSlug and cycle are required.' });
      }
      try {
        const subscription = await subscriptionService.createSubscription({ tenantId, planSlug, cycle });
        return sendWithStatus(reply, 201, { subscription });
      } catch (error) {
        if (error instanceof BillingProviderUnavailableError) {
          return sendBillingProviderUnavailable(reply, error.message);
        }
        throw error;
      }
    },
  });

  // -------------------------------------------------------------------------
  // PUT /plan — Change plan (gated)
  // -------------------------------------------------------------------------

  fastify.put('/plan', {
    schema: {
      tags: ['Billing'],
      summary: 'Change subscription plan',
      operationId: 'changePlan',
      response: {
        200: zodToJsonSchema(SubscriptionResponseSchema),
        501: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const billingOn = await isBillingEnabled(tenantId);
      if (!billingOn) {
        return sendWithStatus(reply, 403, {
          error: 'BILLING_DISABLED',
          message: 'Billing features are not yet available.',
        });
      }
      const { planSlug } = request.body as { planSlug: string };
      if (!planSlug) {
        return sendWithStatus(reply, 400, { error: 'INVALID_INPUT', message: 'planSlug is required.' });
      }
      try {
        const subscription = await subscriptionService.changePlan(tenantId, planSlug);
        return reply.send({ subscription });
      } catch (error) {
        if (error instanceof BillingProviderUnavailableError) {
          return sendBillingProviderUnavailable(reply, error.message);
        }
        throw error;
      }
    },
  });

  // -------------------------------------------------------------------------
  // POST /resume — Resume subscription (gated)
  // -------------------------------------------------------------------------

  fastify.post('/resume', {
    schema: {
      tags: ['Billing'],
      summary: 'Resume a cancelled subscription',
      operationId: 'resumeSubscription',
      response: {
        200: zodToJsonSchema(SubscriptionResponseSchema),
        501: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const billingOn = await isBillingEnabled(tenantId);
      if (!billingOn) {
        return sendWithStatus(reply, 403, {
          error: 'BILLING_DISABLED',
          message: 'Billing features are not yet available.',
        });
      }
      try {
        const subscription = await subscriptionService.resumeSubscription(tenantId);
        return reply.send({ subscription });
      } catch (error) {
        if (error instanceof BillingProviderUnavailableError) {
          return sendBillingProviderUnavailable(reply, error.message);
        }
        throw error;
      }
    },
  });

  // -------------------------------------------------------------------------
  // GET /subscription — Current subscription details
  // -------------------------------------------------------------------------

  fastify.get('/subscription', {
    schema: {
      tags: ['Billing'],
      summary: 'Get current subscription details',
      operationId: 'getSubscription',
      response: { 200: zodToJsonSchema(SubscriptionResponseSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const subscription = await subscriptionService.getSubscription(tenantId);
      return reply.send({ subscription });
    },
  });

  // -------------------------------------------------------------------------
  // POST /payment-method — Setup intent for Stripe Elements
  // -------------------------------------------------------------------------

  fastify.post('/payment-method', {
    schema: {
      tags: ['Billing'],
      summary: 'Create setup intent for Stripe payment method',
      operationId: 'createPaymentMethodSetup',
      response: {
        200: zodToJsonSchema(PaymentMethodSetupResponseSchema),
        400: zodToJsonSchema(ApiErrorSchema),
        501: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const billingOn = await isBillingEnabled(tenantId);
      if (!billingOn) {
        return sendWithStatus(reply, 403, {
          error: 'BILLING_DISABLED',
          message: 'Billing features are not yet available.',
        });
      }
      const subscription = await subscriptionService.getSubscription(tenantId);
      if (!subscription.stripeCustomerId) {
        return sendWithStatus(reply, 400, { error: 'NO_CUSTOMER', message: 'No Stripe customer found.' });
      }
      try {
        const intent = await stripeClient.setupIntents.create({
          customer: subscription.stripeCustomerId,
        });
        return reply.send({ clientSecret: intent.client_secret });
      } catch (error) {
        if (error instanceof BillingProviderUnavailableError) {
          return sendBillingProviderUnavailable(reply, error.message);
        }
        throw error;
      }
    },
  });

  // -------------------------------------------------------------------------
  // GET /portal — Stripe billing portal session URL
  // -------------------------------------------------------------------------

  fastify.get('/portal', {
    schema: {
      tags: ['Billing'],
      summary: 'Get Stripe billing portal session URL',
      operationId: 'getBillingPortal',
      response: {
        200: zodToJsonSchema(BillingPortalResponseSchema),
        400: zodToJsonSchema(ApiErrorSchema),
        501: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const billingOn = await isBillingEnabled(tenantId);
      if (!billingOn) {
        return sendWithStatus(reply, 403, {
          error: 'BILLING_DISABLED',
          message: 'Billing features are not yet available.',
        });
      }
      const subscription = await subscriptionService.getSubscription(tenantId);
      if (!subscription.stripeCustomerId) {
        return sendWithStatus(reply, 400, { error: 'NO_CUSTOMER', message: 'No Stripe customer found.' });
      }
      const returnUrl = (request.query as { returnUrl?: string }).returnUrl ?? '/billing';
      try {
        const session = await stripeClient.billingPortal.sessions.create({
          customer: subscription.stripeCustomerId,
          return_url: returnUrl,
        });
        return reply.send({ url: session.url });
      } catch (error) {
        if (error instanceof BillingProviderUnavailableError) {
          return sendBillingProviderUnavailable(reply, error.message);
        }
        throw error;
      }
    },
  });

  // -------------------------------------------------------------------------
  // POST /trial/start — Start trial (gated)
  // -------------------------------------------------------------------------

  fastify.post('/trial/start', {
    schema: {
      tags: ['Billing'],
      summary: 'Start a trial subscription',
      operationId: 'startTrial',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const billingOn = await isBillingEnabled(tenantId);
      if (!billingOn) {
        return sendWithStatus(reply, 403, {
          error: 'BILLING_DISABLED',
          message: 'Billing features are not yet available.',
        });
      }
      const { planSlug } = request.body as { planSlug?: string };
      const trial = await trialService.startTrial(tenantId, planSlug ?? 'pro');
      return sendWithStatus(reply, 201, { trial });
    },
  });

  // -------------------------------------------------------------------------
  // GET /trial/status — Trial status
  // -------------------------------------------------------------------------

  fastify.get('/trial/status', {
    schema: {
      tags: ['Billing'],
      summary: 'Get current trial status',
      operationId: 'getTrialStatus',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const status = await trialService.checkTrialStatus(tenantId);
      return reply.send({ trial: status });
    },
  });

  // -------------------------------------------------------------------------
  // GET /invoices — Invoice history for tenant
  // -------------------------------------------------------------------------

  fastify.get('/invoices', {
    schema: {
      tags: ['Billing'],
      summary: 'Get invoice history for tenant',
      operationId: 'listInvoices',
      response: { 200: zodToJsonSchema(InvoiceListResponseSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const query = request.query as { page?: string };
      const page = parseInt(query.page ?? '1', 10);
      const result = await invoiceService.getInvoiceHistory(tenantId, page);
      return reply.send({ items: result.items, total: result.total });
    },
  });

  // -------------------------------------------------------------------------
  // GET /invoices/upcoming — Upcoming invoice preview
  // -------------------------------------------------------------------------

  fastify.get('/invoices/upcoming', {
    schema: {
      tags: ['Billing'],
      summary: 'Preview upcoming invoice',
      operationId: 'getUpcomingInvoice',
      response: {
        200: zodToJsonSchema(UpcomingInvoiceResponseSchema),
        501: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      try {
        const invoice = await invoiceService.getUpcomingInvoice(tenantId);
        return reply.send(invoice);
      } catch (error) {
        if (error instanceof InvoicePersistenceUnavailableError) {
          return sendWithStatus(reply, 501, {
            error: 'INVOICE_SYNC_UNAVAILABLE',
            message: error.message,
          });
        }
        throw error;
      }
    },
  });

  // -------------------------------------------------------------------------
  // GET /invoices/:invoiceId — Invoice detail
  // -------------------------------------------------------------------------

  fastify.get('/invoices/:invoiceId', {
    schema: {
      tags: ['Billing'],
      summary: 'Get invoice detail by ID',
      operationId: 'getInvoiceDetail',
      response: {
        200: zodToJsonSchema(InvoiceDetailResponseSchema),
        404: zodToJsonSchema(ApiErrorSchema),
        501: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: async (request, reply) => {
      const { invoiceId } = request.params as { invoiceId: string };
      try {
        const invoice = await invoiceService.getInvoiceDetail(invoiceId);
        return reply.send(invoice);
      } catch (error) {
        if (error instanceof InvoicePersistenceUnavailableError) {
          return sendWithStatus(reply, 501, {
            error: 'INVOICE_SYNC_UNAVAILABLE',
            message: error.message,
          });
        }
        return sendWithStatus(reply, 404, { error: 'INVOICE_NOT_FOUND' });
      }
    },
  });

  // -------------------------------------------------------------------------
  // GET /upgrade-preview/:planSlug — Preview upgrade proration
  // -------------------------------------------------------------------------

  fastify.get('/upgrade-preview/:planSlug', {
    schema: {
      tags: ['Billing'],
      summary: 'Preview upgrade proration for a plan',
      operationId: 'previewUpgrade',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const { planSlug } = request.params as { planSlug: string };
      const preview = await planChangeService.previewUpgrade(tenantId, planSlug);
      return reply.send(preview);
    },
  });

  // -------------------------------------------------------------------------
  // GET /downgrade-preview/:planSlug — Preview downgrade impact
  // -------------------------------------------------------------------------

  fastify.get('/downgrade-preview/:planSlug', {
    schema: {
      tags: ['Billing'],
      summary: 'Preview downgrade impact for a plan',
      operationId: 'previewDowngrade',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const { planSlug } = request.params as { planSlug: string };
      const preview = await planChangeService.previewDowngrade(tenantId, planSlug);
      return reply.send(preview);
    },
  });

  // -------------------------------------------------------------------------
  // GET /cancellation-preview — Preview cancellation impact
  // -------------------------------------------------------------------------

  fastify.get('/cancellation-preview', {
    schema: {
      tags: ['Billing'],
      summary: 'Preview cancellation impact',
      operationId: 'previewCancellation',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const preview = await cancellationService.previewCancellation(tenantId);
      return reply.send(preview);
    },
  });

  // -------------------------------------------------------------------------
  // GET /retention-offer — Get retention offer for tenant
  // -------------------------------------------------------------------------

  fastify.get('/retention-offer', {
    schema: {
      tags: ['Billing'],
      summary: 'Get retention offer for tenant',
      operationId: 'getRetentionOffer',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const offer = await cancellationService.getRetentionOffer(tenantId);
      return reply.send({ offer });
    },
  });

  // -------------------------------------------------------------------------
  // POST /cancel — Cancel subscription with feedback
  // -------------------------------------------------------------------------

  fastify.post('/cancel', {
    schema: {
      tags: ['Billing'],
      summary: 'Cancel subscription with feedback',
      operationId: 'cancelSubscription',
      response: {
        200: zodToJsonSchema(SuccessSchema),
        501: zodToJsonSchema(ApiErrorSchema),
      },
    },
    handler: async (request, reply) => {
      const tenantId = request.tenantContext?.tenantId;
      if (!tenantId) {
        return sendWithStatus(reply, 401, { error: 'UNAUTHORIZED' });
      }
      const billingOn = await isBillingEnabled(tenantId);
      if (!billingOn) {
        return sendWithStatus(reply, 403, {
          error: 'BILLING_DISABLED',
          message: 'Billing features are not yet available.',
        });
      }
      const body = request.body as { reason: string; feedback?: string; immediate?: boolean };
      if (!body.reason) {
        return sendWithStatus(reply, 400, { error: 'REASON_REQUIRED' });
      }
      try {
        await subscriptionService.cancelSubscription(tenantId, body.immediate ?? false);
        await cancellationService.cancel(tenantId, body.reason, body.feedback);
        return reply.send({ success: true });
      } catch (error) {
        if (error instanceof BillingProviderUnavailableError) {
          return sendBillingProviderUnavailable(reply, error.message);
        }
        throw error;
      }
    },
  });

  // -------------------------------------------------------------------------
  // GET /analytics — Revenue metrics (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/analytics', {
    schema: {
      tags: ['Billing'],
      summary: 'Get revenue analytics metrics',
      operationId: 'getRevenueAnalytics',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const isAdmin = request.headers['x-admin-user-id'];
      if (!isAdmin) {
        return sendWithStatus(reply, 403, { error: 'ADMIN_REQUIRED' });
      }
      const metrics = await revenueAnalyticsService.getMetrics();
      return reply.send(metrics);
    },
  });

  // -------------------------------------------------------------------------
  // GET /analytics/subscribers — Subscribers by plan (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/analytics/subscribers', {
    schema: {
      tags: ['Billing'],
      summary: 'Get subscribers grouped by plan',
      operationId: 'getSubscribersByPlan',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const isAdmin = request.headers['x-admin-user-id'];
      if (!isAdmin) {
        return sendWithStatus(reply, 403, { error: 'ADMIN_REQUIRED' });
      }
      const subscribers = await revenueAnalyticsService.getSubscribersByPlan();
      return reply.send({ subscribers });
    },
  });

  // -------------------------------------------------------------------------
  // GET /analytics/trials — Trial metrics (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/analytics/trials', {
    schema: {
      tags: ['Billing'],
      summary: 'Get trial conversion metrics',
      operationId: 'getTrialMetrics',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const isAdmin = request.headers['x-admin-user-id'];
      if (!isAdmin) {
        return sendWithStatus(reply, 403, { error: 'ADMIN_REQUIRED' });
      }
      const trials = await revenueAnalyticsService.getTrialMetrics();
      return reply.send(trials);
    },
  });

  // -------------------------------------------------------------------------
  // GET /analytics/churn — Churn metrics (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/analytics/churn', {
    schema: {
      tags: ['Billing'],
      summary: 'Get churn metrics over time',
      operationId: 'getChurnMetrics',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const isAdmin = request.headers['x-admin-user-id'];
      if (!isAdmin) {
        return sendWithStatus(reply, 403, { error: 'ADMIN_REQUIRED' });
      }
      const query = request.query as { months?: string };
      const months = parseInt(query.months ?? '6', 10);
      const churn = await revenueAnalyticsService.getChurnMetrics(months);
      return reply.send(churn);
    },
  });

  // -------------------------------------------------------------------------
  // GET /enterprise — List enterprise plans (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/enterprise', {
    schema: {
      tags: ['Billing'],
      summary: 'List enterprise plans',
      operationId: 'listEnterprisePlans',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const isAdmin = request.headers['x-admin-user-id'];
      if (!isAdmin) {
        return sendWithStatus(reply, 403, { error: 'ADMIN_REQUIRED' });
      }
      try {
        const plans = await enterpriseService.listEnterprisePlans();
        return reply.send({ plans });
      } catch (error) {
        if (error instanceof EnterprisePlanUnavailableError) {
          return sendBillingProviderUnavailable(reply, error.message);
        }
        throw error;
      }
    },
  });

  // -------------------------------------------------------------------------
  // POST /enterprise — Create enterprise plan (admin only)
  // -------------------------------------------------------------------------

  fastify.post('/enterprise', {
    schema: {
      tags: ['Billing'],
      summary: 'Create a custom enterprise plan',
      operationId: 'createEnterprisePlan',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
    handler: async (request, reply) => {
      const isAdmin = request.headers['x-admin-user-id'];
      if (!isAdmin) {
        return sendWithStatus(reply, 403, { error: 'ADMIN_REQUIRED' });
      }
      const body = request.body as {
        tenantId: string;
        customName: string;
        customMonthlyPriceCents: number;
        basePlan?: string;
        customEntitlements?: Record<string, unknown>;
        billingMethod?: string;
        contractStart?: string;
        contractEnd?: string;
        slaTier?: string;
        whiteLabel?: boolean;
        dedicatedSupportContact?: string;
        notes?: string;
      };
      if (!body.tenantId || !body.customName || !body.customMonthlyPriceCents) {
        return sendWithStatus(reply, 400, { error: 'MISSING_REQUIRED_FIELDS' });
      }
      try {
        const plan = await enterpriseService.createEnterprisePlan({
          tenantId: body.tenantId,
          customName: body.customName,
          customMonthlyPriceCents: body.customMonthlyPriceCents,
          basePlan: body.basePlan,
          customEntitlements: body.customEntitlements,
          billingMethod: body.billingMethod as 'STRIPE' | 'INVOICE' | 'CONTRACT',
          contractStart: body.contractStart ? new Date(body.contractStart) : undefined,
          contractEnd: body.contractEnd ? new Date(body.contractEnd) : undefined,
          slaTier: body.slaTier as 'STANDARD' | 'PREMIUM',
          whiteLabel: body.whiteLabel,
          dedicatedSupportContact: body.dedicatedSupportContact,
          notes: body.notes,
        });
        return sendWithStatus(reply, 201, plan);
      } catch (error) {
        if (error instanceof EnterprisePlanUnavailableError) {
          return sendBillingProviderUnavailable(reply, error.message);
        }
        throw error;
      }
    },
  });

  // -------------------------------------------------------------------------
  // GET /dunning/:tenantId — Dunning status (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/dunning/:tenantId', {
    schema: {
      tags: ['Billing'],
      summary: 'Get dunning status for a tenant',
      operationId: 'getDunningStatus',
      response: { 200: zodToJsonSchema(DunningStatusSchema) },
    },
    handler: async (request, reply) => {
      const isAdmin = request.headers['x-admin-user-id'];
      if (!isAdmin) {
        return sendWithStatus(reply, 403, { error: 'ADMIN_REQUIRED' });
      }
      const { tenantId } = request.params as { tenantId: string };
      const status = await dunningService.getDunningStatus(tenantId);
      return reply.send(status);
    },
  });
}
