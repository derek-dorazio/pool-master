/**
 * Billing DTOs — request/response schemas for billing endpoints.
 */
import { z } from 'zod';

// --- Response Sub-schemas ---

export const PlanDtoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  displayOrder: z.number().optional(),
  monthlyPriceCents: z.number().optional(),
  annualPriceCents: z.number().optional(),
  entitlements: z.record(z.unknown()),
});
export type PlanDto = z.infer<typeof PlanDtoSchema>;

export const UsageDtoSchema = z.object({
  resource: z.string(),
  current: z.number(),
  limit: z.number(),
  percentage: z.number(),
});
export type UsageDto = z.infer<typeof UsageDtoSchema>;

export const InvoiceDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string().optional(),
  stripeInvoiceId: z.string().optional(),
  amount: z.number().optional(),
  amountCents: z.number().optional(),
  currency: z.string(),
  status: z.string(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  paidAt: z.string().datetime().nullable().optional(),
  invoicePdfUrl: z.string().nullable().optional(),
  lineItems: z.array(
    z.object({
      description: z.string(),
      amountCents: z.number(),
      quantity: z.number(),
    }),
  ).optional(),
  createdAt: z.string().datetime().optional(),
});
export type InvoiceDto = z.infer<typeof InvoiceDtoSchema>;

export const SubscriptionDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  stripeCustomerId: z.string(),
  stripeSubscriptionId: z.string().nullable(),
  planSlug: z.string(),
  billingCycle: z.enum(['MONTHLY', 'ANNUAL']),
  status: z.string(),
  trialStart: z.string().datetime().nullable(),
  trialEnd: z.string().datetime().nullable(),
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  cancelledAt: z.string().datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  paymentMethodLast4: z.string().nullable(),
  paymentMethodBrand: z.string().nullable(),
  currency: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SubscriptionDto = z.infer<typeof SubscriptionDtoSchema>;

// --- Responses ---

export const PlanResponseSchema = PlanDtoSchema;
export type PlanResponse = PlanDto;

export const PlansListResponseSchema = z.object({
  plans: z.array(PlanDtoSchema),
  billingEnabled: z.boolean().optional(),
  upgradeLabel: z.string().optional(),
});
export type PlansListResponse = z.infer<typeof PlansListResponseSchema>;

export const UsageResponseSchema = z.object({
  usage: z.object({
    leagues: UsageDtoSchema,
    members: UsageDtoSchema,
    contests: UsageDtoSchema,
  }),
});
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

export const EntitlementsResponseSchema = z.object({
  entitlements: z.record(z.unknown()),
});
export type EntitlementsResponse = z.infer<typeof EntitlementsResponseSchema>;

export const SubscriptionResponseSchema = z.object({
  subscription: SubscriptionDtoSchema,
});
export type SubscriptionResponse = z.infer<typeof SubscriptionResponseSchema>;

export const PaymentMethodSetupResponseSchema = z.object({
  clientSecret: z.string(),
});

export const BillingPortalResponseSchema = z.object({
  url: z.string(),
});

export const InvoiceListResponseSchema = z.object({
  items: z.array(InvoiceDtoSchema),
  total: z.number(),
});
export type InvoiceListResponse = z.infer<typeof InvoiceListResponseSchema>;

export const UpcomingInvoiceResponseSchema = InvoiceDtoSchema;
export const InvoiceDetailResponseSchema = InvoiceDtoSchema;
