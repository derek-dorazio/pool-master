import type { ProviderSummaryDto } from '@/lib/api';
import { Notice, SectionCard, StatusBadge } from '@/features/shared/ui';
import { getStatusTone } from './sync-run-status';

const WORKFLOW_STEPS = [
  'Participants',
  'Mock state',
  'Live scores',
] as const;

/** The Sync page's status section: the order a sync runs in, and each provider's health. */
export function SyncStatusSection({
  providers,
  providersFailed,
}: {
  providers: readonly ProviderSummaryDto[] | undefined;
  providersFailed: boolean;
}) {
  return (
    <SectionCard padded title="Sync status">
      <div className="flex flex-wrap gap-2" data-testid="root-admin-sync-workflow-sequence">
        {WORKFLOW_STEPS.map((step) => (
          <StatusBadge key={step} tone="neutral">
            {step}
          </StatusBadge>
        ))}
      </div>

      {providers && providers.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {providers.map((provider) => (
            <StatusBadge key={provider.providerId} tone="neutral">
              <span className="font-medium text-foreground">
                {provider.providerName}
              </span>
              <StatusBadge className="ml-2 px-2 py-0.5" tone={getStatusTone(provider.status)}>
                {provider.status}
              </StatusBadge>
            </StatusBadge>
          ))}
        </div>
      ) : null}

      {providersFailed ? (
        <Notice className="mt-4">
          Provider health context is temporarily unavailable, but sync runs are
          still shown below.
        </Notice>
      ) : null}
    </SectionCard>
  );
}
