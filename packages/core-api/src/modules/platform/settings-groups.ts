/**
 * Every settings group core-api owns (#450). A new group is declared next to the service that
 * reads it and added here; `AppSettingsService` loads, refreshes and saves all of them.
 */

import type { SettingsGroup } from './settings-group';
import { EMAIL_SETTINGS } from '../email/email-settings';
import { BUDGET_PRICING_SETTINGS } from '../events/budget-pricing-settings';
import { INGESTION_SCHEDULE_SETTINGS } from './ingestion-config-service';
import { PLAN_SETTINGS } from '../plans/plan-settings';
import { BILLING_SETTINGS } from '../billing/billing-settings';

export const SETTINGS_GROUPS: readonly SettingsGroup<unknown>[] = [
  INGESTION_SCHEDULE_SETTINGS,
  EMAIL_SETTINGS,
  BUDGET_PRICING_SETTINGS,
  PLAN_SETTINGS,
  BILLING_SETTINGS,
];
