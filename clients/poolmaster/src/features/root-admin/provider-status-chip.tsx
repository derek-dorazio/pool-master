import { enumLabel } from '@poolmaster/shared/display-strings';
import { Chip } from '@/features/shared/ui';
import { PROVIDER_STATUS_TONES, type ProviderStatus } from './provider-facts';

/** A provider's live health, or Not running for one that is switched off or has no key here. */
export function ProviderStatusChip({ status }: { status: ProviderStatus | null }) {
  if (status === null) return <Chip tone="neutral">Not running</Chip>;
  return <Chip tone={PROVIDER_STATUS_TONES[status]}>{enumLabel('ProviderHealthStatus', status)}</Chip>;
}
