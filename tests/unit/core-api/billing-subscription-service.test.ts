/**
 * Unit tests — SubscriptionService honest provider behavior.
 */

import type { PrismaClient } from '@prisma/client';

const mockIsBillingEnabled = jest.fn<Promise<boolean>, [string?]>();
jest.mock('../../../packages/core-api/src/modules/billing/billing-feature-gate', () => ({
  isBillingEnabled: (...args: any[]) => mockIsBillingEnabled(...args),
}));

import { SubscriptionStatus } from '@poolmaster/shared/domain';
import { BillingProviderUnavailableError } from '../../../packages/core-api/src/modules/billing/stripe-service';
import { SubscriptionService } from '../../../packages/core-api/src/modules/billing/subscription-service';

describe('SubscriptionService', () => {
  const prisma = {
    tenantSubscription: {
      findUnique: jest.fn(),
    },
  } as unknown as PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsBillingEnabled.mockResolvedValue(true);
  });

  it.each([
    ['createSubscription', { tenantId: 'tenant-1', planSlug: 'pro', cycle: 'MONTHLY' as const }],
    ['changePlan', 'pro'],
    ['cancelSubscription', false],
    ['resumeSubscription', undefined],
  ] as const)('throws when provider-backed %s is requested', async (method, arg) => {
    const service = new SubscriptionService(prisma);
    const call =
      method === 'createSubscription'
        ? service.createSubscription(arg as any)
        : method === 'changePlan'
          ? service.changePlan('tenant-1', arg as any)
          : method === 'cancelSubscription'
            ? service.cancelSubscription('tenant-1', arg as any)
            : service.resumeSubscription('tenant-1');

    await expect(call).rejects.toBeInstanceOf(BillingProviderUnavailableError);
  });

  it('returns the free tier when billing is disabled', async () => {
    mockIsBillingEnabled.mockResolvedValue(false);
    const service = new SubscriptionService(prisma);

    await expect(service.getSubscription('tenant-1')).resolves.toMatchObject({
      planSlug: 'free',
      stripeCustomerId: '',
      status: 'ACTIVE',
    });
  });

  it('maps a persisted subscription row into the API shape', async () => {
    const now = new Date('2026-04-03T12:00:00.000Z');
    (prisma.tenantSubscription.findUnique as jest.Mock).mockResolvedValue({
      id: 'sub-1',
      tenantId: 'tenant-1',
      stripeCustomerId: 'cus-1',
      stripeSubscriptionId: 'stripe-sub-1',
      planTierSlug: 'pro',
      billingCycle: 'ANNUAL',
      status: SubscriptionStatus.ACTIVE,
      trialStart: now,
      trialEnd: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      cancelledAt: null,
      cancelAtPeriodEnd: false,
      paymentMethodLast4: '4242',
      paymentMethodBrand: 'visa',
      currency: 'usd',
      createdAt: now,
      updatedAt: now,
    });

    const service = new SubscriptionService(prisma);
    await expect(service.getSubscription('tenant-1')).resolves.toMatchObject({
      id: 'sub-1',
      tenantId: 'tenant-1',
      planSlug: 'pro',
      billingCycle: 'ANNUAL',
      status: SubscriptionStatus.ACTIVE,
      stripeCustomerId: 'cus-1',
      stripeSubscriptionId: 'stripe-sub-1',
    });
  });
});
