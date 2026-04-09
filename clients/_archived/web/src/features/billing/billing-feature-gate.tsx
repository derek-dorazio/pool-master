import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useBillingEnabled } from './hooks/use-billing';

function BillingComingSoon() {
  return (
    <Card>
      <CardContent className="py-8 text-center">
        <p className="text-lg font-medium">Coming Soon</p>
        <p className="mt-2 text-sm text-muted-foreground">
          This feature will be available when paid plans launch.
        </p>
      </CardContent>
    </Card>
  );
}

export function BillingFeatureGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { data: enabled } = useBillingEnabled();

  if (!enabled) return <>{fallback ?? <BillingComingSoon />}</>;
  return <>{children}</>;
}
