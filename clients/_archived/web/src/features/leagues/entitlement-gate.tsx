/**
 * EntitlementGate -- checks plan entitlements before allowing league creation or other gated actions.
 * For the free launch tier, all entitlements pass. This component is wired for when billing is enabled.
 */

import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { client, getEntitlements } from '@/lib/api';

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
      const { data, error } = await getEntitlements({ client });
      if (error) throw error;
      const entitlements = data as unknown as Record<string, Entitlement>;
      return entitlements[entitlementKey] ?? { entitled: true };
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

  // Not entitled -- show upgrade prompt
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
          <p className="text-xs text-muted-foreground">
            Paid plan upgrades are deferred for the MVP launch.
          </p>
        </div>
      )}
    </>
  );
}
