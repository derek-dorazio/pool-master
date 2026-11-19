import { DateDisplay, HelpTip, ReadOnlyDetailModal } from '@/features/shared/ui';
import type { ProviderSummaryDto } from '@/lib/api';
import { errorRatePercent, requestsPerMinuteText } from './provider-facts';
import { ProviderStatusChip } from './provider-status-chip';

/**
 * A provider's dialog (#1873): what the live check found and how we call it, view only. Its key and
 * rate are set in Terraform, so there is no Edit; Check now reads the list again, which checks
 * every provider live.
 */
export function ProviderDialog({
  checkedAt,
  isChecking,
  onCheckNow,
  onClose,
  provider,
}: {
  /** When the list holding this provider was read, which is when it was checked. */
  checkedAt: string;
  isChecking: boolean;
  onCheckNow: () => void;
  onClose: () => void;
  provider: ProviderSummaryDto;
}) {
  const testId = 'root-admin-provider-dialog';
  return (
    <ReadOnlyDetailModal
      action={{ label: 'Check now', onClick: onCheckNow, isPending: isChecking, pendingLabel: 'Checking...', testId: `${testId}-check` }}
      details={[
        { id: 'status', label: 'Status', value: <ProviderStatusChip status={provider.status} /> },
        { id: 'rate', label: 'Requests a minute', value: requestsPerMinuteText(provider) },
        { id: 'checked', label: 'Checked', value: <DateDisplay value={checkedAt} /> },
        { id: 'error-rate', label: 'Error rate (1 h)', value: `${String(errorRatePercent(provider))}%` },
        { id: 'latency', label: 'Latency p95', value: `${String(provider.latencyMs)} ms` },
        { id: 'webhooks', label: 'Webhooks', value: provider.webhooksEnabled ? 'On' : 'Off' },
        { id: 'sport-leagues', label: 'Sport leagues', value: provider.syncedSportLeagueCount },
      ]}
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      size="sm"
      testId={testId}
      title={(
        <span className="inline-flex items-center gap-2">
          {provider.providerName}
          <HelpTip label={`About ${provider.providerName}`} testId={`${testId}-help`}>
            The key and the rate are set in Terraform, so this dialog only reads and checks: there is no Edit.
          </HelpTip>
        </span>
      )}
    />
  );
}
