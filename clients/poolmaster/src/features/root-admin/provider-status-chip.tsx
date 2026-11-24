import { enumLabel } from '@poolmaster/shared/display-strings';
import { Chip } from '@/features/shared/ui';
import { PROVIDER_STATUS_TONES, type ProviderStatus } from './provider-facts';

/** A provider's health from its sync runs of the last hour, or No runs when none finished (#1999). */
export function ProviderStatusChip({ status }: { status: ProviderStatus | null }) {
  if (status === null) return <Chip tone="neutral">No runs</Chip>;
  return <Chip tone={PROVIDER_STATUS_TONES[status]}>{enumLabel('ProviderHealthStatus', status)}</Chip>;
}
