/**
 * PLAN_CONFIG (#944): what each league plan allows, its two caps and the plan each feature
 * starts at. Root admins change it on the Plans page; every core-api task sees a save within the
 * settings refresh. The plan entitlements service is its only reader.
 */

import { PlanConfigSchema, type PlanConfig } from '@poolmaster/shared/dto';
import { LeaguePlan, PlanCap, findFallingPlanLimit } from '@poolmaster/shared/domain';
import { defineSettingsGroup } from '../platform/settings-group';

/** The stored shape, plus what a JSON schema can't say: no cap falls as the plan rises. */
const PlanSettingsSchema = PlanConfigSchema.superRefine((config, context) => {
  for (const cap of Object.values(PlanCap)) {
    const falling = findFallingPlanLimit(config.caps[cap]);
    if (falling) {
      context.addIssue({
        code: 'custom',
        path: ['caps', cap, falling],
        message: `${cap} on ${falling} is below the plan beneath it; a limit never falls as the plan rises.`,
      });
    }
  }
});

export const PLAN_SETTINGS = defineSettingsGroup<PlanConfig>({
  key: 'PLAN_CONFIG',
  title: 'Plans',
  description: 'What each league plan allows: its caps, and the plan each feature starts at.',
  schema: PlanSettingsSchema,
  // Derek's starting numbers (2026-10-22), and each feature at the plan of its old class:
  // the basics free, the rest from Pro, the all-years views Platinum only.
  defaults: () => ({
    caps: {
      ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100 },
      SPORTS_LEAGUES_PER_YEAR: { FREE: 1, PRO: 3, PREMIUM: 10 },
    },
    features: {
      EMAIL_CONTEST_OPENED: LeaguePlan.FREE,
      EMAIL_CONTEST_ENTRY_COMPLETED: LeaguePlan.FREE,
      EMAIL_CONTEST_RESULTS: LeaguePlan.FREE,
      EMAIL_CONTEST_EVENT_CHANGED: LeaguePlan.FREE,
      EMAIL_CONTEST_STARTED_SUMMARY: LeaguePlan.PRO,
      EMAIL_CONTEST_ENTRY_REMINDER: LeaguePlan.PRO,
      EMAIL_CONTEST_STANDINGS: LeaguePlan.PRO,
      EMAIL_EVENT_COMING_UP: LeaguePlan.PRO,
      EMAIL_EVENT_READY_FOR_CONTESTS: LeaguePlan.PRO,
      EMAIL_CONTEST_NOT_OPEN: LeaguePlan.PRO,
      EMAIL_YEAR_IN_REVIEW: LeaguePlan.PRO,
      EMAIL_LEAGUE_MEMBER_JOINED: LeaguePlan.PRO,
      CUP_STANDINGS: LeaguePlan.PRO,
      CUP_CROWNING: LeaguePlan.PRO,
      CHAMPIONSHIP: LeaguePlan.PRO,
      TROPHY_SHELF: LeaguePlan.PRO,
      CUP_SETTINGS: LeaguePlan.PRO,
      PAST_YEARS: LeaguePlan.PRO,
      ALL_TIME_SUMMARY: LeaguePlan.PREMIUM,
      RECORD_BOOK: LeaguePlan.PLATINUM,
    },
  }),
});
