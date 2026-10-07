/**
 * Every settings group core-api owns (#450). A new group is declared next to the service that
 * reads it and added here; `AppSettingsService` loads, refreshes and saves all of them.
 */

import type { SettingsGroup } from './settings-group';
import { INGESTION_SCHEDULE_SETTINGS } from './ingestion-config-service';
import { POLL_INTERVAL_SETTINGS } from './poll-config-service';

export const SETTINGS_GROUPS: readonly SettingsGroup<unknown>[] = [
  POLL_INTERVAL_SETTINGS,
  INGESTION_SCHEDULE_SETTINGS,
];
