import { CONTEST_RULES_LIMITS, tieredRosterChoices } from '@poolmaster/shared/domain';
import type { ContestRulesLimitsDto, TieredRosterChoiceDto } from '@/lib/api';

/** The rules limits the API sends on a template or a managed contest (#2107), for fixtures. */
export const RULES_LIMITS: ContestRulesLimitsDto = { ...CONTEST_RULES_LIMITS };

/** The picks-per-tier choices the API sends for tiers holding these many each (#2107). */
export function tieredChoices(tierSizes: readonly number[]): TieredRosterChoiceDto[] {
  return tieredRosterChoices(tierSizes);
}
