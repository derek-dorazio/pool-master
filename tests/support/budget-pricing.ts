import { DEFAULT_BUDGET_PRICING_PROFILES, type EventPricingConfig } from '@poolmaster/shared/domain';
import { expectDefined } from './expect-defined';

/** The app's default "Standard" profile as an event stores it once priced: $50,000 cap, $100 unit. */
export function standardEventPricing(): EventPricingConfig {
  const { name, ...values } = expectDefined(DEFAULT_BUDGET_PRICING_PROFILES[0]);
  return { profileName: name, ...values };
}
