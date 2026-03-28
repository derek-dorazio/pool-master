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
 *   GET  /invoices/:invoiceId/pdf           → Invoice PDF URL
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

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import type { EntitlementKey } from '@poolmaster/shared/domain';
import { EntitlementService } from './entitlement-service';
import { PlanChangeService } from './plan-change-service';
import { CancellationService } from './cancellation-service';
import { InvoiceService } from './invoice-service';
import { DunningService } from './dunning-service';
import { RevenueAnalyticsService } from './revenue-analytics-service';
import { EnterpriseService } from './enterprise-service';
import { isBillingEnabled } from './billing-feature-gate';
import {
  createSubscription,
  changePlan,
  cancelSubscription as cancelSub,
  resumeSubscription,
  getSubscription,
} from './subscription-service';
import { stripeClient } from './stripe-service';
import { startTrial, checkTrialStatus } from './trial-service';

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

export async function billingModule(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient();
  const entitlementService = new EntitlementService(prisma);
  const planChangeService = new PlanChangeService(prisma);
  const cancellationService = new CancellationService(prisma);
  const invoiceService = new InvoiceService(prisma);
  const dunningService = new DunningService();
  const revenueAnalyticsService = new RevenueAnalyticsService();
  const enterpriseService = new EnterpriseService();

  // -------------------------------------------------------------------------
  // GET /plan — Current plan details for tenant
  // -------------------------------------------------------------------------

  fastify.get('/plan', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planTier: true },
    });

    if (!tenant) {
      return reply.status(404).send({ error: 'TENANT_NOT_FOUND' });
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
  });

  // -------------------------------------------------------------------------
  // GET /entitlements — All entitlement checks for current tenant
  // -------------------------------------------------------------------------

  fastify.get('/entitlements', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }

    const results = await entitlementService.checkMultiple(tenantId, ALL_ENTITLEMENT_KEYS);

    const entitlements: Record<string, unknown> = {};
    for (const [key, result] of results) {
      entitlements[key] = result;
    }

    return reply.send({ entitlements });
  });

  // -------------------------------------------------------------------------
  // GET /usage — Usage summary (leagues, members, contests)
  // -------------------------------------------------------------------------

  fastify.get('/usage', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }

    const [leagues, members, contests] = await Promise.all([
      entitlementService.getUsage(tenantId, 'LEAGUES'),
      entitlementService.getUsage(tenantId, 'MEMBERS'),
      entitlementService.getUsage(tenantId, 'CONTESTS'),
    ]);

    return reply.send({ usage: { leagues, members, contests } });
  });

  // -------------------------------------------------------------------------
  // GET /plans — Available plan tiers (public tiers only)
  // -------------------------------------------------------------------------

  fastify.get('/plans', async (_request, reply) => {
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
  });

  // -------------------------------------------------------------------------
  // POST /subscribe — Create subscription (gated)
  // -------------------------------------------------------------------------

  fastify.post('/subscribe', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return reply.status(403).send({
        error: 'BILLING_DISABLED',
        message: 'Billing features are not yet available.',
      });
    }
    const { planSlug, cycle } = request.body as { planSlug: string; cycle: 'MONTHLY' | 'ANNUAL' };
    if (!planSlug || !cycle) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'planSlug and cycle are required.' });
    }
    const subscription = await createSubscription({ tenantId, planSlug, cycle });
    return reply.status(201).send({ subscription });
  });

  // -------------------------------------------------------------------------
  // PUT /plan — Change plan (gated)
  // -------------------------------------------------------------------------

  fastify.put('/plan', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return reply.status(403).send({
        error: 'BILLING_DISABLED',
        message: 'Billing features are not yet available.',
      });
    }
    const { planSlug } = request.body as { planSlug: string };
    if (!planSlug) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'planSlug is required.' });
    }
    const subscription = await changePlan(tenantId, planSlug);
    return reply.send({ subscription });
  });

  // -------------------------------------------------------------------------
  // POST /resume — Resume subscription (gated)
  // -------------------------------------------------------------------------

  fastify.post('/resume', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return reply.status(403).send({
        error: 'BILLING_DISABLED',
        message: 'Billing features are not yet available.',
      });
    }
    const subscription = await resumeSubscription(tenantId);
    return reply.send({ subscription });
  });

  // -------------------------------------------------------------------------
  // GET /subscription — Current subscription details
  // -------------------------------------------------------------------------

  fastify.get('/subscription', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const subscription = await getSubscription(tenantId);
    return reply.send({ subscription });
  });

  // -------------------------------------------------------------------------
  // POST /payment-method — Setup intent for Stripe Elements
  // -------------------------------------------------------------------------

  fastify.post('/payment-method', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return reply.status(403).send({
        error: 'BILLING_DISABLED',
        message: 'Billing features are not yet available.',
      });
    }
    const subscription = await getSubscription(tenantId);
    if (!subscription.stripeCustomerId) {
      return reply.status(400).send({ error: 'NO_CUSTOMER', message: 'No Stripe customer found.' });
    }
    const intent = await stripeClient.setupIntents.create({
      customer: subscription.stripeCustomerId,
    });
    return reply.send({ clientSecret: intent.client_secret });
  });

  // -------------------------------------------------------------------------
  // GET /portal — Stripe billing portal session URL
  // -------------------------------------------------------------------------

  fastify.get('/portal', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return reply.status(403).send({
        error: 'BILLING_DISABLED',
        message: 'Billing features are not yet available.',
      });
    }
    const subscription = await getSubscription(tenantId);
    if (!subscription.stripeCustomerId) {
      return reply.status(400).send({ error: 'NO_CUSTOMER', message: 'No Stripe customer found.' });
    }
    const returnUrl = (request.query as { returnUrl?: string }).returnUrl ?? '/billing';
    const session = await stripeClient.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
    });
    return reply.send({ url: session.url });
  });

  // -------------------------------------------------------------------------
  // POST /trial/start — Start trial (gated)
  // -------------------------------------------------------------------------

  fastify.post('/trial/start', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return reply.status(403).send({
        error: 'BILLING_DISABLED',
        message: 'Billing features are not yet available.',
      });
    }
    const { planSlug } = request.body as { planSlug?: string };
    const trial = await startTrial(tenantId, planSlug ?? 'pro');
    return reply.status(201).send({ trial });
  });

  // -------------------------------------------------------------------------
  // GET /trial/status — Trial status
  // -------------------------------------------------------------------------

  fastify.get('/trial/status', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const status = await checkTrialStatus(tenantId);
    return reply.send({ trial: status });
  });

  // -------------------------------------------------------------------------
  // GET /invoices — Invoice history for tenant
  // -------------------------------------------------------------------------

  fastify.get('/invoices', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const query = request.query as { page?: string };
    const page = parseInt(query.page ?? '1', 10);
    const result = await invoiceService.getInvoiceHistory(tenantId, page);
    return reply.send(result);
  });

  // -------------------------------------------------------------------------
  // GET /invoices/upcoming — Upcoming invoice preview
  // -------------------------------------------------------------------------

  fastify.get('/invoices/upcoming', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const invoice = await invoiceService.getUpcomingInvoice(tenantId);
    return reply.send(invoice);
  });

  // -------------------------------------------------------------------------
  // GET /invoices/:invoiceId — Invoice detail
  // -------------------------------------------------------------------------

  fastify.get('/invoices/:invoiceId', async (request, reply) => {
    const { invoiceId } = request.params as { invoiceId: string };
    try {
      const invoice = await invoiceService.getInvoiceDetail(invoiceId);
      return reply.send(invoice);
    } catch {
      return reply.status(404).send({ error: 'INVOICE_NOT_FOUND' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /invoices/:invoiceId/pdf — Invoice PDF URL
  // -------------------------------------------------------------------------

  fastify.get('/invoices/:invoiceId/pdf', async (request, reply) => {
    const { invoiceId } = request.params as { invoiceId: string };
    try {
      const url = await invoiceService.getInvoicePdfUrl(invoiceId);
      return reply.send({ url });
    } catch {
      return reply.status(404).send({ error: 'PDF_NOT_AVAILABLE' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /upgrade-preview/:planSlug — Preview upgrade proration
  // -------------------------------------------------------------------------

  fastify.get('/upgrade-preview/:planSlug', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const { planSlug } = request.params as { planSlug: string };
    const preview = await planChangeService.previewUpgrade(tenantId, planSlug);
    return reply.send(preview);
  });

  // -------------------------------------------------------------------------
  // GET /downgrade-preview/:planSlug — Preview downgrade impact
  // -------------------------------------------------------------------------

  fastify.get('/downgrade-preview/:planSlug', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const { planSlug } = request.params as { planSlug: string };
    const preview = await planChangeService.previewDowngrade(tenantId, planSlug);
    return reply.send(preview);
  });

  // -------------------------------------------------------------------------
  // GET /cancellation-preview — Preview cancellation impact
  // -------------------------------------------------------------------------

  fastify.get('/cancellation-preview', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const preview = await cancellationService.previewCancellation(tenantId);
    return reply.send(preview);
  });

  // -------------------------------------------------------------------------
  // GET /retention-offer — Get retention offer for tenant
  // -------------------------------------------------------------------------

  fastify.get('/retention-offer', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const offer = await cancellationService.getRetentionOffer(tenantId);
    return reply.send({ offer });
  });

  // -------------------------------------------------------------------------
  // POST /cancel — Cancel subscription with feedback
  // -------------------------------------------------------------------------

  fastify.post('/cancel', async (request, reply) => {
    const tenantId = request.tenantContext?.tenantId;
    if (!tenantId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return reply.status(403).send({
        error: 'BILLING_DISABLED',
        message: 'Billing features are not yet available.',
      });
    }
    const body = request.body as { reason: string; feedback?: string; immediate?: boolean };
    if (!body.reason) {
      return reply.status(400).send({ error: 'REASON_REQUIRED' });
    }
    await cancelSub(tenantId, body.immediate ?? false);
    await cancellationService.cancel(tenantId, body.reason, body.feedback);
    return reply.send({ success: true });
  });

  // -------------------------------------------------------------------------
  // GET /analytics — Revenue metrics (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/analytics', async (request, reply) => {
    const isAdmin = request.headers['x-admin-user-id'];
    if (!isAdmin) {
      return reply.status(403).send({ error: 'ADMIN_REQUIRED' });
    }
    const metrics = await revenueAnalyticsService.getMetrics();
    return reply.send(metrics);
  });

  // -------------------------------------------------------------------------
  // GET /analytics/subscribers — Subscribers by plan (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/analytics/subscribers', async (request, reply) => {
    const isAdmin = request.headers['x-admin-user-id'];
    if (!isAdmin) {
      return reply.status(403).send({ error: 'ADMIN_REQUIRED' });
    }
    const subscribers = await revenueAnalyticsService.getSubscribersByPlan();
    return reply.send({ subscribers });
  });

  // -------------------------------------------------------------------------
  // GET /analytics/trials — Trial metrics (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/analytics/trials', async (request, reply) => {
    const isAdmin = request.headers['x-admin-user-id'];
    if (!isAdmin) {
      return reply.status(403).send({ error: 'ADMIN_REQUIRED' });
    }
    const trials = await revenueAnalyticsService.getTrialMetrics();
    return reply.send(trials);
  });

  // -------------------------------------------------------------------------
  // GET /analytics/churn — Churn metrics (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/analytics/churn', async (request, reply) => {
    const isAdmin = request.headers['x-admin-user-id'];
    if (!isAdmin) {
      return reply.status(403).send({ error: 'ADMIN_REQUIRED' });
    }
    const query = request.query as { months?: string };
    const months = parseInt(query.months ?? '6', 10);
    const churn = await revenueAnalyticsService.getChurnMetrics(months);
    return reply.send(churn);
  });

  // -------------------------------------------------------------------------
  // GET /enterprise — List enterprise plans (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/enterprise', async (request, reply) => {
    const isAdmin = request.headers['x-admin-user-id'];
    if (!isAdmin) {
      return reply.status(403).send({ error: 'ADMIN_REQUIRED' });
    }
    const plans = await enterpriseService.listEnterprisePlans();
    return reply.send({ plans });
  });

  // -------------------------------------------------------------------------
  // POST /enterprise — Create enterprise plan (admin only)
  // -------------------------------------------------------------------------

  fastify.post('/enterprise', async (request, reply) => {
    const isAdmin = request.headers['x-admin-user-id'];
    if (!isAdmin) {
      return reply.status(403).send({ error: 'ADMIN_REQUIRED' });
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
      return reply.status(400).send({ error: 'MISSING_REQUIRED_FIELDS' });
    }
    const plan = await enterpriseService.createEnterprisePlan({
      tenantId: body.tenantId,
      customName: body.customName,
      customMonthlyPriceCents: body.customMonthlyPriceCents,
      basePlan: body.basePlan,
      billingMethod: body.billingMethod as 'STRIPE' | 'INVOICE' | 'CONTRACT',
      contractStart: body.contractStart ? new Date(body.contractStart) : undefined,
      contractEnd: body.contractEnd ? new Date(body.contractEnd) : undefined,
      slaTier: body.slaTier as 'STANDARD' | 'PREMIUM',
      whiteLabel: body.whiteLabel,
      dedicatedSupportContact: body.dedicatedSupportContact,
      notes: body.notes,
    });
    return reply.status(201).send(plan);
  });

  // -------------------------------------------------------------------------
  // GET /dunning/:tenantId — Dunning status (admin only)
  // -------------------------------------------------------------------------

  fastify.get('/dunning/:tenantId', async (request, reply) => {
    const isAdmin = request.headers['x-admin-user-id'];
    if (!isAdmin) {
      return reply.status(403).send({ error: 'ADMIN_REQUIRED' });
    }
    const { tenantId } = request.params as { tenantId: string };
    const status = await dunningService.getDunningStatus(tenantId);
    return reply.send(status);
  });
}
