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

/** What each plan feature is called on screen (#946); an email's name is its template's. */
export const PLAN_FEATURE_LABEL: Readonly<Record<PlanFeature, string>> = {
  [PlanFeature.EMAIL_CONTEST_OPENED]: 'New contest open',
  [PlanFeature.EMAIL_CONTEST_ENTRY_COMPLETED]: 'Entry confirmation',
  [PlanFeature.EMAIL_CONTEST_RESULTS]: 'Final results',
  [PlanFeature.EMAIL_CONTEST_EVENT_CHANGED]: 'Event postponed or cancelled',
  [PlanFeature.EMAIL_CONTEST_STARTED_SUMMARY]: 'Contest started',
  [PlanFeature.EMAIL_CONTEST_ENTRY_REMINDER]: 'Entry reminders',
  [PlanFeature.EMAIL_CONTEST_STANDINGS]: 'Live standings',
  [PlanFeature.EMAIL_EVENT_COMING_UP]: 'Event coming up (commissioners)',
  [PlanFeature.EMAIL_EVENT_READY_FOR_CONTESTS]: 'Event ready for contests (commissioners)',
  [PlanFeature.EMAIL_CONTEST_NOT_OPEN]: 'Contest not open yet (commissioners)',
  [PlanFeature.EMAIL_YEAR_IN_REVIEW]: 'Year in review',
  [PlanFeature.CUP_STANDINGS]: 'Cup standings',
  [PlanFeature.CUP_CROWNING]: 'Crowning cup winners',
  [PlanFeature.CHAMPIONSHIP]: 'The Championship tab',
  [PlanFeature.TROPHY_SHELF]: 'Trophy shelf',
  [PlanFeature.CUP_SETTINGS]: 'Cup settings',
  [PlanFeature.PAST_YEARS]: 'Past years',
  [PlanFeature.ALL_TIME_SUMMARY]: 'All years summary',
  [PlanFeature.RECORD_BOOK]: 'Record book and Hall of Lame',
};

/** What each group of plan features is called on screen (#946). */
export const PLAN_FEATURE_GROUP_LABEL: Readonly<Record<PlanFeatureGroup, string>> = {
  [PlanFeatureGroup.EMAILS]: 'Emails',
  [PlanFeatureGroup.CHAMPIONSHIPS]: 'Championships',
  [PlanFeatureGroup.HISTORY]: 'History',
};
