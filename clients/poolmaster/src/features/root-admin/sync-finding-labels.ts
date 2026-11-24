import { enumLabel } from '@poolmaster/shared/display-strings';
import {
  ProviderSyncFindingSeverity,
  ProviderSyncFindingStatus,
} from '@poolmaster/shared/domain';
import type { StatusBadgeProps } from '@/features/shared/ui';
import type { ProviderSyncFindingDto } from '@/lib/api';

/** Each severity's badge tone on Findings and the Sports page (#1999): layout, not a domain value. */
export const SYNC_FINDING_SEVERITY_TONES: Record<ProviderSyncFindingSeverity, StatusBadgeProps['tone']> = {
  [ProviderSyncFindingSeverity.ERROR]: 'failed',
  [ProviderSyncFindingSeverity.WARNING]: 'info',
  [ProviderSyncFindingSeverity.INFO]: 'neutral',
};

/** Each status's badge tone. */
export const SYNC_FINDING_STATUS_TONES: Record<ProviderSyncFindingStatus, StatusBadgeProps['tone']> = {
  [ProviderSyncFindingStatus.OPEN]: 'active',
  [ProviderSyncFindingStatus.RESOLVED]: 'completed',
  [ProviderSyncFindingStatus.WAIVED]: 'inactive',
};

/**
 * What the finding is about, after its sport league: the feed's value with its name when it sent
 * one ("Scottie Scheffler (2081)"), else its event, else its Provider; null when none.
 */
export function syncFindingSubject(finding: Pick<ProviderSyncFindingDto, 'providerValue' | 'providerValueName' | 'sportEvent' | 'provider'>): string | null {
  if (finding.providerValue !== null) {
    return finding.providerValueName === null ? finding.providerValue : `${finding.providerValueName} (${finding.providerValue})`;
  }
  return finding.sportEvent?.name ?? finding.provider?.name ?? null;
}

/** The dialog's title: its kind, then what it is about. */
export function syncFindingTitle(finding: ProviderSyncFindingDto): string {
  const subject = syncFindingSubject(finding);
  const kind = enumLabel('ProviderSyncFindingKind', finding.kind);
  return subject === null ? kind : `${kind} · ${subject}`;
}
