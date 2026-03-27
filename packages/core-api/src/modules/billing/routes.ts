/**
 * Billing module — plan tier, entitlement, and usage routes.
 *
 * Routes:
 *   GET /plan          → Current plan details for tenant
 *   GET /entitlements  → All entitlement checks for current tenant
 *   GET /usage         → Usage summary (leagues, members, contests)
 *   GET /plans         → Available plan tiers (public tiers only)
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import type { EntitlementKey } from '@poolmaster/shared/domain';
import { EntitlementService } from './entitlement-service';

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

    return reply.send({ plans: tiers });
  });
}
