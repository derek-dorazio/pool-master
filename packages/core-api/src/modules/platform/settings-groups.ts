/**
 * Every settings group core-api owns (#450). A new group is declared next to the service that
 * reads it and added here; `AppSettingsService` loads, refreshes and saves all of them.
 */

import type { SettingsGroup } from './settings-group';
import { EMAIL_SETTINGS } from '../email/email-settings';
import { INGESTION_SCHEDULE_SETTINGS } from './ingestion-config-service';

export const SETTINGS_GROUPS: readonly SettingsGroup<unknown>[] = [
  INGESTION_SCHEDULE_SETTINGS,
  EMAIL_SETTINGS,
];
