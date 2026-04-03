/**
 * InvoiceService — handles invoice history, detail, and upcoming invoice
 * preview using real persisted/provider-backed data only.
 *
 * The repo does not yet have invoice persistence or Stripe sync tables, so
 * invoice history currently surfaces as empty and detail/preview operations
 * fail explicitly instead of fabricating records.
 */

import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Invoice {
  id: string;
  tenantId: string;
  stripeInvoiceId: string;
  amountCents: number;
  currency: string;
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  invoicePdfUrl: string | null;
  lineItems: InvoiceLineItem[];
  createdAt: Date;
}

export interface InvoiceLineItem {
  description: string;
  amountCents: number;
  quantity: number;
}

const ITEMS_PER_PAGE = 20;

export class InvoicePersistenceUnavailableError extends Error {
  constructor(operation: 'detail' | 'upcoming') {
    super(`Invoice ${operation} is unavailable until provider-backed invoice persistence is implemented`);
    this.name = 'InvoicePersistenceUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class InvoiceService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get paginated invoice history for a tenant.
   */
  async getInvoiceHistory(
    tenantId: string,
    page: number = 1,
  ): Promise<{ items: Invoice[]; total: number }> {
    await this.ensureTenantExists(tenantId);

    const start = Math.max(0, (page - 1) * ITEMS_PER_PAGE);
    const items: Invoice[] = [];

    return {
      items: items.slice(start, start + ITEMS_PER_PAGE),
      total: 0,
    };
  }

  /**
   * Get a single invoice by ID.
   */
  async getInvoiceDetail(invoiceId: string): Promise<Invoice> {
    void invoiceId;
    throw new InvoicePersistenceUnavailableError('detail');
  }

  /**
   * Get the upcoming invoice preview for a tenant.
   */
  async getUpcomingInvoice(tenantId: string): Promise<Invoice> {
    await this.ensureTenantExists(tenantId);
    throw new InvoicePersistenceUnavailableError('upcoming');
  }

  private async ensureTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }
  }
}
