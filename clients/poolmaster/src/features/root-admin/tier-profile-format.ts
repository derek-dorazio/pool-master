import { enumLabel } from '@poolmaster/shared/display-strings';
import { PlatformTierProfileLastTier } from '@poolmaster/shared/domain';
import type { PlatformTierProfileDto } from '@/lib/api';

/** "All remaining", or "Capped at 15" with the most the last tier takes. */
export function describeLastTier(profile: Pick<PlatformTierProfileDto, 'lastTier' | 'lastTierMax'>): string {
  return profile.lastTier === PlatformTierProfileLastTier.CAPPED && profile.lastTierMax !== null
    ? `Capped at ${profile.lastTierMax}`
    : enumLabel('PlatformTierProfileLastTier', profile.lastTier);
}
