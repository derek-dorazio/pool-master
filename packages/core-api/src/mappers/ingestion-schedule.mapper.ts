/**
 * The ingestion schedule as the API answers it (#2086): each sync kind's policy, with whether it
 * runs and whether it has a switch, read from the policy itself. A policy with no `enabled` has no
 * switch and always runs (the FIELD sync), so no client re-derives which kind that is.
 */

import type { IngestionSchedule, IngestionScheduleConfig, IngestionSyncSchedule } from '@poolmaster/shared/dto/config.dto';
import { ProviderSyncKind } from '@poolmaster/shared/domain';

function toSyncSchedule(policy: IngestionScheduleConfig[ProviderSyncKind]): IngestionSyncSchedule {
  const switchable = 'enabled' in policy;
  return { ...policy, runs: switchable ? policy.enabled : true, switchable };
}

export function toIngestionScheduleDto(config: IngestionScheduleConfig): IngestionSchedule {
  return {
    [ProviderSyncKind.EVENTS]: toSyncSchedule(config.EVENTS),
    [ProviderSyncKind.FIELD]: toSyncSchedule(config.FIELD),
    [ProviderSyncKind.SCORES]: toSyncSchedule(config.SCORES),
  };
}
