import { enumLabel } from '@poolmaster/shared/display-strings';
import { Chip } from '@/features/shared/ui';
import { PROVIDER_STATUS_TONES, type ProviderStatus } from './provider-facts';

export function ProviderStatusChip({ status }: { status: ProviderStatus }) {
  return <Chip tone={PROVIDER_STATUS_TONES[status]}>{enumLabel('ProviderHealthStatus', status)}</Chip>;
}
