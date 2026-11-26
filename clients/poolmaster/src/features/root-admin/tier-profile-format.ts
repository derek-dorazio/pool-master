import { enumLabel } from '@poolmaster/shared/display-strings';
import { PlatformTierProfileLastTier, TierProfileType, type FieldOrderBasis } from '@poolmaster/shared/domain';
import type { PlatformTierProfileDto } from '@/lib/api';

/** "All remaining", or "Capped at 15" with the most the last tier takes. */
export function describeLastTier(profile: { lastTier: PlatformTierProfileLastTier; lastTierMax: number | null }): string {
  return profile.lastTier === PlatformTierProfileLastTier.CAPPED && profile.lastTierMax !== null
    ? `Capped at ${profile.lastTierMax}`
    : enumLabel('PlatformTierProfileLastTier', profile.lastTier);
}

/** "1 · 2–4 · 5+": each tier's seeds or ranks, first tier first. */
export function describeRanges(ranges: readonly { fromValue: number; toValue: number | null }[]): string {
  return ranges
    .map(({ fromValue, toValue }) => (toValue === null ? `${fromValue}+` : toValue === fromValue ? String(fromValue) : `${fromValue}–${toValue}`))
    .join(' · ');
}

/** How a profile lays out its tiers, as its grid row and its dialog say it. */
export function describeTierLayout(profile: PlatformTierProfileDto): string {
  return profile.type === TierProfileType.RANGES
    ? `${enumLabel('TierProfileType', profile.type)}: ${describeRanges(profile.ranges)}`
    : `${profile.tierCount} × ${profile.tierSize}, last tier ${describeLastTier(profile).toLowerCase()}`;
}

/** "Seed, Odds, Rank": the profile's sources in order. */
export function describeSources(sources: readonly FieldOrderBasis[]): string {
  return sources.map((source) => enumLabel('FieldOrderBasis', source)).join(', ');
}
