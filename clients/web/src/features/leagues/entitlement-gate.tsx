/**
 * EntitlementGate — checks plan entitlements before allowing league creation or other gated actions.
 * For the free launch tier, all entitlements pass. This component is wired for when billing is enabled.
 */

import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

interface Entitlement {
  entitled: boolean;
  currentUsage?: number;
  limit?: number;
  upgradePlan?: string;
  reason?: string;
}

function useEntitlement(entitlementKey: string) {
  return useQuery({
    queryKey: ['entitlements', entitlementKey],
    queryFn: async (): Promise<Entitlement> => {
      // Free tier = always entitled
      // TODO: Replace with real API when billing is enabled
      // return api.get(`/v1/entitlements/check?key=${entitlementKey}`);
      return { entitled: true };
    },
    staleTime: 5 * 60 * 1000,
  });
}

interface EntitlementGateProps {
  /** The entitlement key to check, e.g. 'league.create', 'contest.create' */
  entitlementKey: string;
  children: React.ReactNode;
  /** What to show when the user is not entitled */
  fallback?: React.ReactNode;
}

export function EntitlementGate({ entitlementKey, children, fallback }: EntitlementGateProps) {
  const { data: entitlement, isLoading } = useEntitlement(entitlementKey);

  if (isLoading) return <>{children}</>; // Don't block while loading

  if (entitlement?.entitled) return <>{children}</>;

  // Not entitled — show upgrade prompt
  return (
    <>
      {fallback ?? (
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-semibold">Plan Limit Reached</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {entitlement?.reason ?? `You've reached the limit for your current plan.`}
            {entitlement?.currentUsage !== undefined && entitlement?.limit !== undefined && (
              <> ({entitlement.currentUsage} / {entitlement.limit})</>
            )}
          </p>
          {entitlement?.upgradePlan && (
            <Button asChild size="sm">
              <Link to="/billing/plans">Upgrade Plan</Link>
            </Button>
          )}
        </div>
      )}
    </>
  );
}
