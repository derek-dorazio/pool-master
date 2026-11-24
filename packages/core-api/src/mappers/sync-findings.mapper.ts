/** Sync finding mapper (#1999): the domain finding to its DTO, with the actions it offers now. */
import { providerSyncFindingActions, type ProviderSyncFinding } from '@poolmaster/shared/domain';
import type { ProviderSyncFindingDto } from '@poolmaster/shared/dto';
import { formatUserName } from '../modules/email/email-content';

export function toProviderSyncFindingDto(finding: ProviderSyncFinding): ProviderSyncFindingDto {
  return {
    id: finding.id,
    kind: finding.kind,
    severity: finding.severity,
    status: finding.status,
    sportLeague: { id: finding.sportLeague.id, name: finding.sportLeague.name, sport: finding.sportLeague.sport },
    sportEvent: finding.sportEvent === null ? null : { id: finding.sportEvent.id, name: finding.sportEvent.name },
    provider: finding.provider === null ? null : { id: finding.provider.id, name: finding.provider.name },
    providerValue: finding.providerValue,
    providerValueName: finding.providerValueName,
    waiveNote: finding.waiveNote,
    firstSeenAt: finding.firstSeenAt.toISOString(),
    lastSeenAt: finding.lastSeenAt.toISOString(),
    seenCount: finding.seenCount,
    statusChangedAt: finding.statusChangedAt.toISOString(),
    statusChangedBy: finding.statusChangedBy === null
      ? null
      : { id: finding.statusChangedBy.id, displayName: formatUserName(finding.statusChangedBy) },
    actions: providerSyncFindingActions(finding),
  };
}
