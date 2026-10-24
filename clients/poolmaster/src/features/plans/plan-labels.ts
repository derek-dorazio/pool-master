import { LeaguePlan, PlanCap, PlanFeature, PlanFeatureGroup } from '@poolmaster/shared/domain';

/** What each league plan is called on screen (#943). Always "plan", never "tier". */
export const LEAGUE_PLAN_LABEL: Readonly<Record<LeaguePlan, string>> = {
  [LeaguePlan.FREE]: 'Free',
  [LeaguePlan.PRO]: 'Pro',
  [LeaguePlan.PREMIUM]: 'Premium',
  [LeaguePlan.PLATINUM]: 'Platinum',
};

/** What each plan cap is called on screen (#944). */
export const PLAN_CAP_LABEL: Readonly<Record<PlanCap, string>> = {
  [PlanCap.ENTRIES_PER_CONTEST]: 'Entries per contest',
  [PlanCap.SPORTS_LEAGUES_PER_YEAR]: 'Sports leagues a year',
};

/** A cap's limit on screen: the number, or "Unlimited". */
export function formatPlanLimit(limit: number | null): string {
  return limit === null ? 'Unlimited' : limit.toLocaleString('en-US');
}

/** What each plan feature is called on screen, in the comparison table and the admin Plans page. */
export const PLAN_FEATURE_LABEL: Readonly<Record<PlanFeature, string>> = {
  [PlanFeature.EMAIL_CONTEST_OPENED]: 'Contest open email',
  [PlanFeature.EMAIL_CONTEST_ENTRY_COMPLETED]: 'Entry confirmation email',
  [PlanFeature.EMAIL_CONTEST_RESULTS]: 'Contest results email',
  [PlanFeature.EMAIL_CONTEST_EVENT_CHANGED]: 'Event change email',
  [PlanFeature.EMAIL_CONTEST_STARTED_SUMMARY]: 'Contest started email',
  [PlanFeature.EMAIL_CONTEST_ENTRY_REMINDER]: 'Entry reminder email',
  [PlanFeature.EMAIL_CONTEST_STANDINGS]: 'Standings email',
  [PlanFeature.EMAIL_EVENT_COMING_UP]: 'Coming up email',
  [PlanFeature.EMAIL_EVENT_READY_FOR_CONTESTS]: 'Ready for contests email',
  [PlanFeature.EMAIL_CONTEST_NOT_OPEN]: 'Contest not open email',
  [PlanFeature.EMAIL_YEAR_IN_REVIEW]: 'Year in review email',
  [PlanFeature.CUP_STANDINGS]: 'Sports league cups',
  [PlanFeature.CUP_CROWNING]: 'Crowning cups',
  [PlanFeature.CHAMPIONSHIP]: 'League championship',
  [PlanFeature.TROPHY_SHELF]: 'Trophy shelf',
  [PlanFeature.CUP_SETTINGS]: 'Championship settings',
  [PlanFeature.PAST_YEARS]: 'Past years',
  [PlanFeature.ALL_TIME_SUMMARY]: 'All-time summary',
  [PlanFeature.RECORD_BOOK]: 'Record book',
};

/** What each group of plan features is called on screen. */
export const PLAN_FEATURE_GROUP_LABEL: Readonly<Record<PlanFeatureGroup, string>> = {
  [PlanFeatureGroup.EMAILS]: 'Emails',
  [PlanFeatureGroup.CHAMPIONSHIPS]: 'Championships',
  [PlanFeatureGroup.HISTORY]: 'History',
};
