import { TierProfileLastTier } from '@poolmaster/shared/domain';
import type { TierProfileDto } from '@/lib/api';

/** What a tier profile's last tier takes, as the Profiles grid and dialog name it (#1849). */
export const LAST_TIER_LABELS: Record<TierProfileLastTier, string> = {
  [TierProfileLastTier.ALL_REMAINING]: 'All remaining',
  [TierProfileLastTier.CAPPED]: 'Capped',
};

/** "All remaining", or "Capped at 15" with the most the last tier takes. */
export function describeLastTier(profile: Pick<TierProfileDto, 'lastTier' | 'lastTierMax'>): string {
  return profile.lastTier === TierProfileLastTier.CAPPED && profile.lastTierMax !== null
    ? `Capped at ${profile.lastTierMax}`
    : LAST_TIER_LABELS[profile.lastTier];
}
