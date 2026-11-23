import { enumLabel } from '@poolmaster/shared/display-strings';
import { SportLeagueSyncHealth } from '@poolmaster/shared/domain';
import { Chip, type ChipProps } from '@/features/shared/ui';

const SYNC_HEALTH_TONES: Record<SportLeagueSyncHealth, ChipProps['tone']> = {
  [SportLeagueSyncHealth.OK]: 'success',
  [SportLeagueSyncHealth.ERROR]: 'danger',
  [SportLeagueSyncHealth.NOT_RUN_YET]: 'neutral',
  [SportLeagueSyncHealth.OFF]: 'inactive',
};

/** A sync health as its chip: OK green, ERROR red, NOT RUN YET grey, OFF faded. */
export function SyncHealthChip({ health }: { health: SportLeagueSyncHealth }) {
  return <Chip tone={SYNC_HEALTH_TONES[health]}>{enumLabel('SportLeagueSyncHealth', health)}</Chip>;
}
