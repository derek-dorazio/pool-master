import { Chip } from '@/features/shared/ui';
import { PROVIDER_STATUS_LABELS, PROVIDER_STATUS_TONES, type ProviderStatus } from './provider-facts';

export function ProviderStatusChip({ status }: { status: ProviderStatus }) {
  return <Chip tone={PROVIDER_STATUS_TONES[status]}>{PROVIDER_STATUS_LABELS[status]}</Chip>;
}
