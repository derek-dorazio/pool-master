import { z } from 'zod';
import {
  PlanCap,
  findFallingPlanLimit,
  type LeaguePlan,
  type PlanFeature,
} from '@poolmaster/shared/domain';
import { PlanConfigSchema } from '@poolmaster/shared/dto';
import type { PlanConfig } from '@/lib/api';

/** One cell of the Plans page's caps grid: Unlimited, or the number typed in. */
export type PlanCapCellDraft = { unlimited: boolean; limit: string };

/** PLAN_CONFIG as the Plans page edits it (#946). */
export type PlanSettingsDraft = {
  caps: Record<PlanCap, Record<LeaguePlan, PlanCapCellDraft>>;
  features: Record<PlanFeature, LeaguePlan>;
};

export const PLAN_CAP_LIMIT_MESSAGE = 'Enter a whole number from 1 to 100,000, or choose Unlimited.';
export const PLAN_CAP_FALLING_MESSAGE = 'Can\'t be lower than the plan before it: a limit never falls as the plan rises.';

function mapCaps<T>(map: (cap: PlanCap, plan: LeaguePlan) => T): Record<PlanCap, Record<LeaguePlan, T>> {
  const row = (cap: PlanCap) => ({
    FREE: map(cap, 'FREE'),
    PRO: map(cap, 'PRO'),
    PREMIUM: map(cap, 'PREMIUM'),
    PLATINUM: map(cap, 'PLATINUM'),
  } satisfies Record<LeaguePlan, T>);
  return {
    ENTRIES_PER_CONTEST: row(PlanCap.ENTRIES_PER_CONTEST),
    SPORTS_LEAGUES_PER_YEAR: row(PlanCap.SPORTS_LEAGUES_PER_YEAR),
  };
}

export function toPlanSettingsDraft(config: PlanConfig): PlanSettingsDraft {
  return {
    caps: mapCaps((cap, plan) => {
      const limit = config.caps[cap][plan];
      return limit === null ? { unlimited: true, limit: '' } : { unlimited: false, limit: String(limit) };
    }),
    features: { ...config.features },
  };
}

/** A typed limit as a number; anything but digits is NaN, so the stored schema refuses it. */
function parseLimit(cell: PlanCapCellDraft): number | null {
  if (cell.unlimited) {
    return null;
  }
  const typed = cell.limit.trim();
  return /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
}

export function toPlanConfig(draft: PlanSettingsDraft): PlanConfig {
  return {
    caps: mapCaps((cap, plan) => parseLimit(draft.caps[cap][plan])),
    features: { ...draft.features },
  };
}

/**
 * The server's own checks on the draft, each placed on the cell it is about: the stored schema's
 * limits, then that no cap falls as the plan rises.
 */
export const PlanSettingsDraftSchema = z.custom<PlanSettingsDraft>().superRefine((draft, context) => {
  const config = toPlanConfig(draft);
  const parsed = PlanConfigSchema.safeParse(config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: 'custom', path: [...issue.path, 'limit'], message: PLAN_CAP_LIMIT_MESSAGE });
    }
    return;
  }
  for (const cap of Object.values(PlanCap)) {
    const falling = findFallingPlanLimit(config.caps[cap]);
    if (falling) {
      context.addIssue({ code: 'custom', path: ['caps', cap, falling, 'limit'], message: PLAN_CAP_FALLING_MESSAGE });
    }
  }
});
