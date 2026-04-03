/**
 * InvoiceService — handles invoice history, detail, and
 * upcoming invoice preview. Uses mock data until Stripe integration
 * is live.
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ITEMS_PER_PAGE = 20;

// ---------------------------------------------------------------------------
// Mock invoice generator
// ---------------------------------------------------------------------------

function generateMockInvoices(tenantId: string): Invoice[] {
  const now = new Date();
  const invoices: Invoice[] = [];
  for (let i = 0; i < 4; i++) {
    const periodEnd = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const periodStart = new Date(now.getFullYear(), now.getMonth() - i - 1, 1);
    const paidAt = i > 0
      ? new Date(periodStart.getFullYear(), periodStart.getMonth(), 3)
      : null;
    const status: Invoice['status'] = i === 0 ? 'OPEN' : 'PAID';
    invoices.push({
      id: `inv-${tenantId}-${i}`,
      tenantId,
      stripeInvoiceId: `in_mock_${tenantId}_${i}`,
      amountCents: 2900,
      currency: 'usd',
      status,
      periodStart,
      periodEnd,
      paidAt,
      invoicePdfUrl: status === 'PAID'
        ? `https://pay.stripe.com/invoice/mock_${tenantId}_${i}/pdf`
        : null,
      lineItems: [
        {
          description: 'PoolMaster Pro - Monthly',
          amountCents: 2900,
          quantity: 1,
        },
      ],
      createdAt: periodStart,
    });
  }
  return invoices;
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
    const allInvoices = generateMockInvoices(tenantId);
    const start = (page - 1) * ITEMS_PER_PAGE;
    const items = allInvoices.slice(start, start + ITEMS_PER_PAGE);
    return { items, total: allInvoices.length };
  }

  /**
   * Get a single invoice by ID.
   */
  async getInvoiceDetail(invoiceId: string): Promise<Invoice> {
    // Parse tenant from the mock invoice ID format: inv-{tenantId}-{index}
    const parts = invoiceId.split('-');
    const tenantId = parts.length >= 3 ? parts.slice(1, -1).join('-') : 'unknown';
    const allInvoices = generateMockInvoices(tenantId);
    const invoice = allInvoices.find((inv) => inv.id === invoiceId);
    if (!invoice) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }
    return invoice;
  }

  /**
   * Get the upcoming invoice preview for a tenant.
   */
  async getUpcomingInvoice(tenantId: string): Promise<Invoice> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      id: `inv-${tenantId}-upcoming`,
      tenantId,
      stripeInvoiceId: `in_upcoming_${tenantId}`,
      amountCents: 2900,
      currency: 'usd',
      status: 'DRAFT',
      periodStart,
      periodEnd,
      paidAt: null,
      invoicePdfUrl: null,
      lineItems: [
        {
          description: 'PoolMaster Pro - Monthly (upcoming)',
          amountCents: 2900,
          quantity: 1,
        },
      ],
      createdAt: new Date(),
    };
  }
}
