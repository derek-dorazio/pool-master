import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import {
  EqualGroupsLayoutSchema,
  explicitOrderValues,
  FieldOrderBasisOrder,
  PlatformTierProfileLastTier,
  TierProfileType,
  TierRangeSchema,
} from '@poolmaster/shared/domain';
import { PlatformTierProfileWriteRequestSchema } from '@poolmaster/shared/dto';
import type { PlatformTierProfileDto, PlatformTierProfileWriteRequest } from '@/lib/api';
import { numberFieldErrors } from '@/lib/number-field-errors';

/** The tier profile editor's form (#1849, #2160): its values, the request they make, and its checks. */

const { shape } = EqualGroupsLayoutSchema;
const countRange = (min: number, max: number) => `From ${min} to ${max}.`;

export const LAST_TIER_MAX_BLANK = 'Enter the most the last tier takes.';

const tierErrors = numberFieldErrors({
  tierCount: { schema: shape.tierCount, range: countRange, blank: 'Enter how many tiers.', whole: 'Whole numbers only.' },
  tierSize: { schema: shape.tierSize, range: countRange, blank: 'Enter how many go in each tier.', whole: 'Whole numbers only.' },
  lastTierMax: { schema: shape.lastTierMax.unwrap(), range: countRange, blank: LAST_TIER_MAX_BLANK, whole: 'Whole numbers only.' },
  fromValue: { schema: TierRangeSchema.shape.fromValue, range: countRange, blank: 'Enter where the tier starts.', whole: 'Whole numbers only.' },
  toValue: { schema: TierRangeSchema.shape.toValue.unwrap(), range: countRange, blank: 'Enter where the tier ends.', whole: 'Whole numbers only.' },
});

type EqualGroupsRequest = Extract<PlatformTierProfileWriteRequest, { type: typeof TierProfileType.EQUAL_GROUPS }>;
type RangesRequest = Extract<PlatformTierProfileWriteRequest, { type: typeof TierProfileType.RANGES }>;
/** A range row as the form holds it: its tier is its place in the list. */
type RangeRow = Omit<RangesRequest['ranges'][number], 'tierNumber'>;

/**
 * The form's values: both layouts' fields at once, so switching the type keeps what was typed
 * in the other. The save sends only the chosen layout's (`requestOf`).
 */
export type TierProfileFormValues = Omit<EqualGroupsRequest, 'type'> & {
  type: PlatformTierProfileWriteRequest['type'];
  ranges: RangeRow[];
};

const ALL_SOURCES = explicitOrderValues(FieldOrderBasisOrder);
export const NEW_RANGE: RangeRow = { fromValue: 1, toValue: null };

const NEW_PROFILE: TierProfileFormValues = {
  code: '',
  name: '',
  sources: ALL_SOURCES,
  type: TierProfileType.EQUAL_GROUPS,
  tierCount: 6,
  tierSize: 10,
  lastTier: PlatformTierProfileLastTier.ALL_REMAINING,
  lastTierMax: null,
  ranges: [NEW_RANGE],
};

export function formValuesOf(profile: PlatformTierProfileDto | null): TierProfileFormValues {
  if (profile === null) return NEW_PROFILE;
  const identity = { code: profile.code, name: profile.name, sources: [...profile.sources] };
  return profile.type === TierProfileType.EQUAL_GROUPS
    ? { ...NEW_PROFILE, ...identity, type: profile.type, tierCount: profile.tierCount, tierSize: profile.tierSize, lastTier: profile.lastTier, lastTierMax: profile.lastTierMax }
    : { ...NEW_PROFILE, ...identity, type: profile.type, ranges: profile.ranges.map(({ fromValue, toValue }) => ({ fromValue, toValue })) };
}

/** The request for the chosen layout: a cap only for a capped last tier, each range numbered by its place. */
export function requestOf(values: TierProfileFormValues): PlatformTierProfileWriteRequest {
  const identity = { code: values.code, name: values.name, sources: values.sources };
  if (values.type === TierProfileType.RANGES) {
    return { ...identity, type: values.type, ranges: values.ranges.map((range, index) => ({ tierNumber: index + 1, fromValue: range.fromValue, toValue: range.toValue })) };
  }
  return {
    ...identity,
    type: values.type,
    tierCount: values.tierCount,
    tierSize: values.tierSize,
    lastTier: values.lastTier,
    lastTierMax: values.lastTier === PlatformTierProfileLastTier.CAPPED ? values.lastTierMax : null,
  };
}

const requestResolver = zodResolver(PlatformTierProfileWriteRequestSchema, { error: tierErrors });

/**
 * The request's own shape, checked on the request the save would send: the paths are the form's
 * (`tierCount`, `ranges.1.toValue`), since the two share field names. Whether the layout can be
 * used (a capped last tier with its most, ranges with no gap) is the server's call.
 */
export const tierProfileResolver: Resolver<TierProfileFormValues> = async (values, context, options) => {
  const result = await requestResolver(requestOf(values), context, options as never);
  return Object.keys(result.errors).length === 0 ? { values, errors: {} } : { values: {}, errors: result.errors as never };
};

