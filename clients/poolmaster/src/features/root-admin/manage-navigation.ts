import { getSportDefinition, type Sport, sportVocabulary } from '@poolmaster/shared/domain';
import type { PageLinkTab } from '@/features/shared/ui';
import { upperFirst } from '@/lib/upper-first';

type ManageSectionDefinition = {
  /** The tab's selector suffix. */
  key: string;
  title: string;
  to: string;
  /**
   * Every path the tab stays lit under (#1848). Where two tabs' paths nest, the longest match
   * wins.
   */
  paths: readonly string[];
};

/**
 * Every sport's Manage pages sit under one path (plans/racing-sports.md Q9.6): its events,
 * their field, tiers and results, its participants and its sport leagues. One copy of each
 * page serves every sport; the page reads the sport's words from its definition. A sport is
 * addressed by its stored URL segment (SportDto.urlSegment), which every DTO that links to one
 * carries.
 */
export const SPORTS_PATH = '/manage/sports';

export function buildSportPath(sportUrlSegment: string) {
  return `${SPORTS_PATH}/${sportUrlSegment}`;
}

export function buildSportEventListPath(sportUrlSegment: string) {
  return `${buildSportPath(sportUrlSegment)}/events`;
}

export function buildSportEventPath(sportUrlSegment: string, eventId: string) {
  return `${buildSportEventListPath(sportUrlSegment)}/${eventId}`;
}

/** The New test event page (#2004), opening on this sport league. */
export function buildTestEventCreatePath(sportUrlSegment: string, sportLeagueId: string) {
  return `${buildSportEventListPath(sportUrlSegment)}/new?${new URLSearchParams({ sportLeagueId }).toString()}`;
}

/** A sport league's page; the sport's leagues are listed together on the Sports page (#1848). */
export function buildSportLeaguePath(sportUrlSegment: string, sportLeagueId: string) {
  return `${buildSportPath(sportUrlSegment)}/leagues/${sportLeagueId}`;
}

/** The platform's tier and pricing profiles (#1849), the Sports page's second tab. */
export const PROFILES_PATH = `${SPORTS_PATH}/profiles`;

/** Every system email and the email settings (#1872). */
export const NOTIFICATIONS_PATH = '/manage/notifications';

/**
 * The old settings page's path, gone since every group moved to its own page (#1886). It redirects
 * to Pricing, the last group to leave it.
 */
export const SETTINGS_PATH = '/manage/settings';

/** The providers and the one sync schedule every sport league follows (#1873). */
export const PROVIDERS_PATH = '/manage/providers';

/** Every background job (#1887), the same Activity grid a league's and an event's tabs show. */
export const ACTIVITY_PATH = '/manage/activity';

/** Customers (#1883): every league and every user on the platform, a tab each. */
export const CUSTOMERS_PATH = '/manage/customers';
export const CUSTOMER_LEAGUES_PATH = `${CUSTOMERS_PATH}/leagues`;
export const CUSTOMER_USERS_PATH = `${CUSTOMERS_PATH}/users`;

/** The search parameters that open one league's or one user's dialog on its tab. */
export const CUSTOMER_LEAGUE_PARAM = 'league';
export const CUSTOMER_USER_PARAM = 'user';

/** What each plan costs and what expanding a contest costs on it (#1886). */
export const PRICING_PATH = '/manage/pricing';

/**
 * Manage's top menu, in order (#1848): Sports · Activity · Notifications · Providers · Customers ·
 * Plans · Pricing. Run event sync and Findings sit under Providers.
 */
const MANAGE_SECTION_DEFINITIONS: ManageSectionDefinition[] = [
  { key: 'sports', title: 'Sports', to: SPORTS_PATH, paths: [SPORTS_PATH, '/manage/events', '/manage/content-configuration'] },
  { key: 'activity', title: 'Activity', to: ACTIVITY_PATH, paths: [ACTIVITY_PATH] },
  { key: 'notifications', title: 'Notifications', to: NOTIFICATIONS_PATH, paths: [NOTIFICATIONS_PATH] },
  { key: 'providers', title: 'Providers', to: PROVIDERS_PATH, paths: [PROVIDERS_PATH] },
  { key: 'customers', title: 'Customers', to: CUSTOMER_LEAGUES_PATH, paths: [CUSTOMERS_PATH] },
  { key: 'plans', title: 'Plans', to: '/manage/plans', paths: ['/manage/plans'] },
  { key: 'pricing', title: 'Pricing', to: PRICING_PATH, paths: [PRICING_PATH] },
];

/** Where `/manage` itself lands: Sports, every sport league in one grid. */
export const MANAGE_LANDING_PATH = SPORTS_PATH;

/** One user, opened in their dialog on Customers › Users (#1883). */
export function buildManageUserPath(userId: string) {
  return `${CUSTOMER_USERS_PATH}?${new URLSearchParams({ [CUSTOMER_USER_PARAM]: userId }).toString()}`;
}

export const PLANS_PATH = '/manage/plans';

/** Where the old sync run history page and its tools lived, before Activity and Providers (#1887). */
export const LEGACY_SYNC_PATH = '/manage/sync';

/** A root admin's manual sync of one event's feeds. */
export const RUN_EVENT_SYNC_PATH = `${PROVIDERS_PATH}/run-event-sync`;

/** The one list of problems the sync found (#1999), under Providers. */
export const SYNC_FINDINGS_PATH = `${PROVIDERS_PATH}/findings`;

/** The page that maps an unmapped participant finding's feed id to a participant of its league. */
export function buildSyncFindingMapParticipantPath(findingId: string) {
  return `${SYNC_FINDINGS_PATH}/${findingId}/map-participant`;
}

function isAtOrUnder(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The longest of `paths` the page sits at or under; 0 when none. */
function matchLength(pathname: string, paths: readonly string[]): number {
  return Math.max(0, ...paths.filter((path) => isAtOrUnder(pathname, path)).map((path) => path.length));
}

/** Manage's top tabs; a tool's sub-pages keep its tab lit, the tab with the longest matching path. */
export function buildManageTabs(pathname: string): PageLinkTab[] {
  const lengths = MANAGE_SECTION_DEFINITIONS.map((section) => matchLength(pathname, section.paths));
  const best = Math.max(...lengths);
  return MANAGE_SECTION_DEFINITIONS.map((section, index) => ({
    isActive: best > 0 && lengths[index] === best,
    label: section.title,
    testId: `root-admin-manage-menu-${section.key}`,
    to: section.to,
  }));
}

const STATIC_BREADCRUMB_LABELS: Record<string, string> = {
  sports: 'Sports',
  events: 'Events',
  'content-configuration': 'Contest templates',
  activity: 'Activity',
  notifications: 'Notifications',
  leagues: 'Leagues',
  users: 'Users',
  plans: 'Plans',
  'run-event-sync': 'Run event sync',
  findings: 'Findings',
  'map-participant': 'Map participant',
  providers: 'Providers',
  field: 'Field',
  tiers: 'Tiers',
  results: 'Results',
  new: 'New',
  edit: 'Edit details',
  schedule: 'Schedule',
  profiles: 'Profiles',
};

/** A sport's two lists, labelled in the sport's own words: "Tournaments", "Golfers". */
const SPORT_LIST_LABELS = {
  events: (sport: Sport) => upperFirst(sportVocabulary(sport).event.many),
  participants: (sport: Sport) => upperFirst(sportVocabulary(sport).participant.many),
} as const satisfies Record<string, (sport: Sport) => string>;

function isSportListSegment(segment: string): segment is keyof typeof SPORT_LIST_LABELS {
  return Object.hasOwn(SPORT_LIST_LABELS, segment);
}

/** A sport as an address names it: the platform's sports, as `listSports` gives them. */
export interface SportAddress {
  sport: Sport;
  urlSegment: string;
}

/**
 * The label of the segment at `index` of a path under `/manage`. Under `sports/<sport>/`, the
 * sport, found among `sports` by its URL segment, reads its name and its lists read the sport's
 * words.
 */
export function getManageBreadcrumbLabel(segments: readonly string[], index: number, sports: readonly SportAddress[] = []): string {
  const segment = segments[index];
  const sport = segments[0] === 'sports' ? sports.find((candidate) => candidate.urlSegment === segments[1])?.sport ?? null : null;
  if (sport && index === 1) {
    return getSportDefinition(sport).name;
  }
  if (sport && index === 2 && isSportListSegment(segment)) {
    return SPORT_LIST_LABELS[segment](sport);
  }
  if (sport && index === 2 && segment === 'leagues') {
    return 'Sport leagues';
  }

  const staticLabel = STATIC_BREADCRUMB_LABELS[segment];
  if (staticLabel) {
    return staticLabel;
  }

  const section = MANAGE_SECTION_DEFINITIONS.find(
    (candidate) => candidate.key === segment,
  );
  if (section) {
    return section.title;
  }

  return decodeURIComponent(segment);
}
