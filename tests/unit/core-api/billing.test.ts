/**
 * Unit tests — Billing module (routes, entitlement service, usage service)
 *
 * Tests the billing route handlers with mocked Prisma and services.
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mock billing-feature-gate before importing routes
// ---------------------------------------------------------------------------
const mockIsBillingEnabled = jest.fn<Promise<boolean>, [string?]>();
jest.mock('../../../packages/core-api/src/modules/billing/billing-feature-gate', () => ({
  isBillingEnabled: (...args: any[]) => mockIsBillingEnabled(...args),
}));

// Mock Prisma at the module level
const mockPrismaClient = {
  tenant: {
    findUnique: jest.fn(),
  },
  planTier: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  entitlementOverride: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
    delete: jest.fn(),
  },
  tenantUsage: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrismaClient),
}));

// Mock stripe-service
jest.mock('../../../packages/core-api/src/modules/billing/stripe-service', () => ({
  stripeClient: {
    setupIntents: { create: jest.fn() },
    billingPortal: { sessions: { create: jest.fn() } },
  },
}));

// Mock sub-services that have complex constructors
jest.mock('../../../packages/core-api/src/modules/billing/subscription-service', () => ({
  SubscriptionService: jest.fn().mockImplementation(() => ({
    getSubscription: jest.fn().mockResolvedValue({ status: 'ACTIVE', stripeCustomerId: null }),
    createSubscription: jest.fn().mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' }),
    changePlan: jest.fn().mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' }),
    resumeSubscription: jest.fn().mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' }),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../../packages/core-api/src/modules/billing/trial-service', () => ({
  TrialService: jest.fn().mockImplementation(() => ({
    startTrial: jest.fn().mockResolvedValue({ trialEnd: '2026-04-30' }),
    checkTrialStatus: jest.fn().mockResolvedValue({ active: false }),
  })),
}));

jest.mock('../../../packages/core-api/src/modules/billing/plan-change-service', () => ({
  PlanChangeService: jest.fn().mockImplementation(() => ({
    previewUpgrade: jest.fn().mockResolvedValue({ proratedAmount: 0 }),
    previewDowngrade: jest.fn().mockResolvedValue({ impactedFeatures: [] }),
  })),
}));

jest.mock('../../../packages/core-api/src/modules/billing/cancellation-service', () => ({
  CancellationService: jest.fn().mockImplementation(() => ({
    previewCancellation: jest.fn().mockResolvedValue({ effectiveDate: '2026-04-30' }),
    getRetentionOffer: jest.fn().mockResolvedValue(null),
    cancel: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../../packages/core-api/src/modules/billing/invoice-service', () => ({
  InvoiceService: jest.fn().mockImplementation(() => ({
    getInvoiceHistory: jest.fn().mockResolvedValue({ invoices: [], total: 0 }),
    getUpcomingInvoice: jest.fn().mockResolvedValue(null),
    getInvoiceDetail: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    getInvoicePdfUrl: jest.fn().mockResolvedValue('https://example.com/pdf'),
  })),
}));

jest.mock('../../../packages/core-api/src/modules/billing/dunning-service', () => ({
  DunningService: jest.fn().mockImplementation(() => ({
    getDunningStatus: jest.fn().mockResolvedValue({ status: 'NONE' }),
  })),
}));

jest.mock('../../../packages/core-api/src/modules/billing/revenue-analytics-service', () => ({
  RevenueAnalyticsService: jest.fn().mockImplementation(() => ({
    getMetrics: jest.fn().mockResolvedValue({ mrr: 0 }),
    getSubscribersByPlan: jest.fn().mockResolvedValue([]),
    getTrialMetrics: jest.fn().mockResolvedValue({ activeTrials: 0 }),
    getChurnMetrics: jest.fn().mockResolvedValue({ churnRate: 0 }),
  })),
}));

jest.mock('../../../packages/core-api/src/modules/billing/enterprise-service', () => ({
  EnterpriseService: jest.fn().mockImplementation(() => ({
    listEnterprisePlans: jest.fn().mockResolvedValue([]),
    createEnterprisePlan: jest.fn().mockResolvedValue({ id: 'ent-1' }),
  })),
}));

import { billingModule } from '../../../packages/core-api/src/modules/billing/routes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let app: FastifyInstance;

function buildApp(): FastifyInstance {
  const fastify = Fastify({ logger: false });

  // Minimal tenant-context decorator to simulate auth
  fastify.decorateRequest('tenantContext', undefined as any);
  fastify.addHook('onRequest', async (request) => {
    const authHeader = request.headers.authorization;
    if (authHeader === 'Bearer valid-token') {
      (request as any).tenantContext = { tenantId: 'tenant-1' };
    }
  });

  fastify.register(billingModule, { prefix: '/api/v1/billing' });
  return fastify;
}

const authedHeaders = { authorization: 'Bearer valid-token' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockIsBillingEnabled.mockResolvedValue(false);
});

describe('Billing routes', () => {
  // -----------------------------------------------------------------------
  // GET /plan
  // -----------------------------------------------------------------------
  describe('GET /api/v1/billing/plan', () => {
    it('returns 401 when no auth token is provided', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/billing/plan' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'UNAUTHORIZED' });
    });

    it('returns plan details when tenant has a known plan tier', async () => {
      mockPrismaClient.tenant.findUnique.mockResolvedValue({ planTier: 'free' });
      mockPrismaClient.planTier.findUnique.mockResolvedValue({
        slug: 'free',
        name: 'Free',
        monthlyPriceCents: 0,
        annualPriceCents: 0,
        entitlements: { max_leagues: -1 },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/plan',
        headers: authedHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.slug).toBe('free');
      expect(body.name).toBe('Free');
      expect(body.entitlements).toEqual({ max_leagues: -1 });
    });

    it('returns fallback when plan tier is not found in PlanTier table', async () => {
      mockPrismaClient.tenant.findUnique.mockResolvedValue({ planTier: 'unknown-tier' });
      mockPrismaClient.planTier.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/plan',
        headers: authedHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.slug).toBe('unknown-tier');
      expect(body.entitlements).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // GET /plans
  // -----------------------------------------------------------------------
  describe('GET /api/v1/billing/plans', () => {
    it('returns public plan tiers with billing status', async () => {
      mockIsBillingEnabled.mockResolvedValue(false);
      mockPrismaClient.planTier.findMany.mockResolvedValue([
        { slug: 'free', name: 'Free', displayOrder: 1, monthlyPriceCents: 0, annualPriceCents: 0, trialDays: 0, entitlements: {} },
      ]);

      const res = await app.inject({ method: 'GET', url: '/api/v1/billing/plans' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.plans).toHaveLength(1);
      expect(body.billingEnabled).toBe(false);
      expect(body.upgradeLabel).toBe('Coming Soon');
    });
  });

  // -----------------------------------------------------------------------
  // GET /usage
  // -----------------------------------------------------------------------
  describe('GET /api/v1/billing/usage', () => {
    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/billing/usage' });
      expect(res.statusCode).toBe(401);
    });

    it('returns usage data for authenticated tenant', async () => {
      // EntitlementService.getUsage will be called; with billing off it returns defaults.
      // Since we mock isBillingEnabled=false, entitlement service returns fail-open defaults.
      mockPrismaClient.tenant.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/usage',
        headers: authedHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.usage).toBeDefined();
      expect(body.usage).toHaveProperty('leagues');
      expect(body.usage).toHaveProperty('members');
      expect(body.usage).toHaveProperty('contests');
    });
  });

  // -----------------------------------------------------------------------
  // GET /entitlements
  // -----------------------------------------------------------------------
  describe('GET /api/v1/billing/entitlements', () => {
    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/billing/entitlements' });
      expect(res.statusCode).toBe(401);
    });

    it('returns entitlement map for authenticated tenant', async () => {
      // With billing disabled, loadEntitlements returns null, checkMultiple returns { entitled: true }
      mockPrismaClient.tenant.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/entitlements',
        headers: authedHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entitlements).toBeDefined();
      // Should have entries for all entitlement keys
      expect(Object.keys(body.entitlements).length).toBeGreaterThan(0);
    });
  });
});
