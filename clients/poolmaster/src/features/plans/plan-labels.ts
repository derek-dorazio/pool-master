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

/** One line under each cap in the comparison table (#971). */
export const PLAN_CAP_DESCRIPTION: Readonly<Record<PlanCap, string>> = {
  [PlanCap.ENTRIES_PER_CONTEST]: 'Every entry counts, drafts included.',
  [PlanCap.SPORTS_LEAGUES_PER_YEAR]: 'The PGA TOUR, the NFL, the NBA and so on, counted from this year\'s contests.',
};

/** The "In every plan" row the lowest plan's card also names among its highlights. */
export const EVERY_CONTEST_TYPE_LABEL = 'Every contest type';

/** What every plan includes (#971): the comparison table's "In every plan" rows. Not plan settings. */
export const EVERY_PLAN_INCLUDES: readonly { key: string; label: string; description: string; value: string | true }[] = [
  { key: 'members', label: 'Members and invites', description: 'Invite as many people as you like.', value: 'Unlimited' },
  { key: 'contest-types', label: EVERY_CONTEST_TYPE_LABEL, description: 'Tiers, budget, snake draft, pick\'em, survivor, brackets, squares and more.', value: true },
  { key: 'leaderboards', label: 'Live leaderboards', description: 'Standings move as the scores come in.', value: true },
  { key: 'results', label: 'Contest results and history', description: 'Places and results for every finished contest.', value: true },
];

/** One line under each plan's name on the plan cards (#971): who the plan is for. */
export const LEAGUE_PLAN_TAGLINE: Readonly<Record<LeaguePlan, string>> = {
  [LeaguePlan.FREE]: 'Try a pool with friends or a small office.',
  [LeaguePlan.PRO]: 'For a regular office pool through the season.',
  [LeaguePlan.PREMIUM]: 'For bigger leagues that play several sports.',
  [LeaguePlan.PLATINUM]: 'Everything, for leagues that play all year.',
};

/** A cap as a plan card's highlight (#971): "Up to 50 entries per contest", "3 sports leagues a year". */
export function formatPlanCapHighlight(cap: PlanCap, limit: number | null): string {
  switch (cap) {
    case PlanCap.ENTRIES_PER_CONTEST:
      return limit === null ? 'Unlimited entries per contest' : `Up to ${limit.toLocaleString('en-US')} entries per contest`;
    case PlanCap.SPORTS_LEAGUES_PER_YEAR:
      return limit === null
        ? 'Every sports league, every year'
        : `${limit.toLocaleString('en-US')} ${limit === 1 ? 'sports league' : 'sports leagues'} a year`;
  }
}

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
  [PlanFeature.ALL_TIME_SUMMARY]: 'All years',
  [PlanFeature.RECORD_BOOK]: 'Record book',
};

/** One line under each feature in the comparison table (#971): what it does, for a visitor. */
export const PLAN_FEATURE_DESCRIPTION: Readonly<Record<PlanFeature, string>> = {
  [PlanFeature.EMAIL_CONTEST_OPENED]: 'Tells members a contest is ready to enter.',
  [PlanFeature.EMAIL_CONTEST_ENTRY_COMPLETED]: 'A receipt when an entry is in.',
  [PlanFeature.EMAIL_CONTEST_RESULTS]: 'Final places when a contest ends.',
  [PlanFeature.EMAIL_CONTEST_EVENT_CHANGED]: 'When an event is moved or cancelled.',
  [PlanFeature.EMAIL_CONTEST_STARTED_SUMMARY]: 'Who picked what, once picks close.',
  [PlanFeature.EMAIL_CONTEST_ENTRY_REMINDER]: 'Nudges members who haven\'t entered yet.',
  [PlanFeature.EMAIL_CONTEST_STANDINGS]: 'Where everyone stands while the event plays out.',
  [PlanFeature.EMAIL_EVENT_COMING_UP]: 'A heads-up on the events ahead.',
  [PlanFeature.EMAIL_EVENT_READY_FOR_CONTESTS]: 'For commissioners: an event is ready to set up.',
  [PlanFeature.EMAIL_CONTEST_NOT_OPEN]: 'For commissioners: a contest still needs opening.',
  [PlanFeature.EMAIL_YEAR_IN_REVIEW]: 'The season\'s winners, once the year is over.',
  [PlanFeature.CUP_STANDINGS]: 'A season-long cup for each sports league.',
  [PlanFeature.CUP_CROWNING]: 'A cup winner crowned at the end of the season.',
  [PlanFeature.CHAMPIONSHIP]: 'One standings table across every sport.',
  [PlanFeature.TROPHY_SHELF]: 'Every member\'s cups and trophies.',
  [PlanFeature.CUP_SETTINGS]: 'Choose which contests count, and how much.',
  [PlanFeature.PAST_YEARS]: 'Every earlier season, kept.',
  [PlanFeature.ALL_TIME_SUMMARY]: 'Champions and cups across every season.',
  [PlanFeature.RECORD_BOOK]: 'Best and worst finishes of all time.',
};

/** What each group of plan features is called on screen. */
export const PLAN_FEATURE_GROUP_LABEL: Readonly<Record<PlanFeatureGroup, string>> = {
  [PlanFeatureGroup.EMAILS]: 'Emails',
  [PlanFeatureGroup.CHAMPIONSHIPS]: 'Championships',
  [PlanFeatureGroup.HISTORY]: 'History',
};

/**
 * A group's features as one counted highlight line (#971), used when a plan has three or more of
 * them to list: "4 emails" on the lowest plan, "7 more emails" on a plan that adds them.
 */
export function formatPlanFeatureGroupHighlight(group: PlanFeatureGroup, count: number, isAddition: boolean): string {
  const more = isAddition ? ' more' : '';
  switch (group) {
    case PlanFeatureGroup.EMAILS:
      return `${count}${more} emails`;
    case PlanFeatureGroup.CHAMPIONSHIPS:
      return `${count}${more} championship features`;
    case PlanFeatureGroup.HISTORY:
      return `${count}${more} history features`;
  }
}
