import { enumLabel } from '@poolmaster/shared/display-strings';
import { TierProfileLastTier } from '@poolmaster/shared/domain';
import type { TierProfileDto } from '@/lib/api';

/** "All remaining", or "Capped at 15" with the most the last tier takes. */
export function describeLastTier(profile: Pick<TierProfileDto, 'lastTier' | 'lastTierMax'>): string {
  return profile.lastTier === TierProfileLastTier.CAPPED && profile.lastTierMax !== null
    ? `Capped at ${profile.lastTierMax}`
    : enumLabel('TierProfileLastTier', profile.lastTier);
}
