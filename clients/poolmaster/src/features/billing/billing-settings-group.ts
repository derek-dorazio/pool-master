import type { SettingsGroup } from '@/lib/api';

/** The payments settings group (BILLING_CONFIG), which the Pricing page reads and saves whole. */
export type BillingSettingsGroup = Extract<SettingsGroup, { key: 'BILLING_CONFIG' }>;
