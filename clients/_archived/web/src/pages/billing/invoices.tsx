import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useBillingEnabled,
  useInvoices,
} from '@/features/billing/hooks/use-billing';
import type { InvoiceStatus } from '@/features/billing/hooks/use-billing';

const statusColors: Record<InvoiceStatus, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

export function Component() {
  const { data: billingEnabled, isLoading: enabledLoading } = useBillingEnabled();
  const { data: invoices, isLoading: invoicesLoading } = useInvoices();

  const invoiceItems = invoices?.items ?? [];
  const showEmptyFreeState = !billingEnabled || (invoices && invoiceItems.length === 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Invoice History</h1>
        <p className="text-muted-foreground">
          View, download, and manage receipts for all past payments.
        </p>
      </div>

      {enabledLoading || invoicesLoading ? (
        <Card>
          <CardContent className="space-y-4 py-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : showEmptyFreeState ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto max-w-sm space-y-3">
              <p className="text-lg font-medium">No invoices yet</p>
              <p className="text-sm text-muted-foreground">
                {!billingEnabled
                  ? 'Ultimate Pool Manager is currently free for all users. Invoices will appear here once paid plans are available.'
                  : 'Invoices will appear here after your first paid billing cycle.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Invoices</CardTitle>
            <CardDescription>
              {invoices?.total ?? 0} invoice{invoices?.total !== 1 ? 's' : ''} found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-medium">Date</th>
                    <th className="pb-3 pr-4 font-medium">Invoice #</th>
                    <th className="pb-3 pr-4 font-medium">Amount</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceItems.map((invoice) => (
                    <tr key={invoice.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">{invoice.date}</td>
                      <td className="py-3 pr-4 font-mono text-xs">
                        {invoice.number}
                      </td>
                      <td className="py-3 pr-4">${invoice.amount.toFixed(2)}</td>
                      <td className="py-3 pr-4">
                        <Badge
                          className={statusColors[invoice.status]}
                          aria-label={`Status: ${invoice.status}`}
                        >
                          {invoice.status.charAt(0).toUpperCase() +
                            invoice.status.slice(1)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
