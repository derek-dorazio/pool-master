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
  currentCount: z.number(),
  limit: z.number(),
  percentage: z.number(),
});
export type UsageDto = z.infer<typeof UsageDtoSchema>;

export const InvoiceDtoSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.string(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  createdAt: z.string().datetime().optional(),
});
export type InvoiceDto = z.infer<typeof InvoiceDtoSchema>;

// --- Responses ---

export const PlanResponseSchema = PlanDtoSchema;
export type PlanResponse = PlanDto;

export const PlansListResponseSchema = z.object({
  plans: z.array(PlanDtoSchema),
});
export type PlansListResponse = z.infer<typeof PlansListResponseSchema>;

export const UsageResponseSchema = z.object({
  usage: z.array(UsageDtoSchema),
});
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

export const EntitlementsResponseSchema = z.object({
  entitlements: z.record(z.unknown()),
});
export type EntitlementsResponse = z.infer<typeof EntitlementsResponseSchema>;

export const InvoiceListResponseSchema = z.object({
  invoices: z.array(InvoiceDtoSchema),
});
export type InvoiceListResponse = z.infer<typeof InvoiceListResponseSchema>;
