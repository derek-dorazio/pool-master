import { SUPPORTED_SPORTS, getSportDefinition, sportPathSegment, type Sport } from '@poolmaster/shared/domain';
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

export function parseSportPathSegment(segment: string | undefined): Sport | null {
  return SUPPORTED_SPORTS.find((sport) => sportPathSegment(sport) === segment) ?? null;
}

/**
 * Every sport's Manage pages sit under one path (plans/racing-sports.md Q9.6): its events,
 * their field, tiers and results, its participants and its sport leagues. One copy of each
 * page serves every sport; the page reads the sport's words from its definition.
 */
export const SPORTS_PATH = '/manage/sports';

export function buildSportPath(sport: Sport) {
  return `${SPORTS_PATH}/${sportPathSegment(sport)}`;
}

export function buildSportEventListPath(sport: Sport) {
  return `${buildSportPath(sport)}/events`;
}

export function buildSportEventPath(sport: Sport, eventId: string) {
  return `${buildSportEventListPath(sport)}/${eventId}`;
}

/** A sport league's page; the sport's leagues are listed together on the Sports page (#1848). */
export function buildSportLeaguePath(sport: Sport, sportLeagueId: string) {
  return `${buildSportPath(sport)}/leagues/${sportLeagueId}`;
}

/** Where a new sport league is made. */
export function buildSportLeagueCreatePath(sport: Sport) {
  return `${buildSportPath(sport)}/leagues/new`;
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

/** What each plan costs and what expanding a contest costs on it (#1886). */
export const PRICING_PATH = '/manage/pricing';

/**
 * Manage's top menu, in order (#1848): Sports · Activity · Notifications · Providers · Customers ·
 * Plans · Pricing. Run event sync and Unmapped participants sit under Providers.
 */
const MANAGE_SECTION_DEFINITIONS: ManageSectionDefinition[] = [
  { key: 'sports', title: 'Sports', to: SPORTS_PATH, paths: [SPORTS_PATH, '/manage/events', '/manage/content-configuration'] },
  { key: 'activity', title: 'Activity', to: ACTIVITY_PATH, paths: [ACTIVITY_PATH] },
  { key: 'notifications', title: 'Notifications', to: NOTIFICATIONS_PATH, paths: [NOTIFICATIONS_PATH] },
  { key: 'providers', title: 'Providers', to: PROVIDERS_PATH, paths: [PROVIDERS_PATH] },
  { key: 'customers', title: 'Customers', to: '/manage/leagues', paths: ['/manage/leagues', '/manage/users'] },
  { key: 'plans', title: 'Plans', to: '/manage/plans', paths: ['/manage/plans'] },
  { key: 'pricing', title: 'Pricing', to: PRICING_PATH, paths: [PRICING_PATH] },
];

/** Where `/manage` itself lands: Sports, every sport league in one grid. */
export const MANAGE_LANDING_PATH = SPORTS_PATH;

/** How long a server-searched Manage list waits after the last key before it asks (#1180). */
export const SEARCH_DEBOUNCE_MS = 300;

export function buildManageUserPath(userId: string) {
  return `/manage/users/${userId}`;
}

export const PLANS_PATH = '/manage/plans';

/** Where the old sync run history page and its tools lived, before Activity and Providers (#1887). */
export const LEGACY_SYNC_PATH = '/manage/sync';

/** A root admin's manual sync of one event's feeds. */
export const RUN_EVENT_SYNC_PATH = `${PROVIDERS_PATH}/run-event-sync`;

export const UNMAPPED_COMPETITORS_PATH = `${PROVIDERS_PATH}/unmapped-participants`;

/** The page that maps one unmapped competitor; a provider's id can hold any character. */
export function buildMapCompetitorPath(providerId: string, externalId: string) {
  const query = new URLSearchParams({ provider: providerId, competitor: externalId });
  return `${UNMAPPED_COMPETITORS_PATH}/map?${query.toString()}`;
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

/** Manage's second row, null where a tool has none: under Customers, Leagues and Users. */
export function buildManageSubTabs(pathname: string): { label: string; items: PageLinkTab[] } | null {
  if (isAtOrUnder(pathname, '/manage/leagues') || isAtOrUnder(pathname, '/manage/users')) {
    return {
      label: 'Customers',
      items: [
        { isActive: isAtOrUnder(pathname, '/manage/leagues'), label: 'Leagues', testId: 'root-admin-manage-menu-leagues', to: '/manage/leagues' },
        { isActive: isAtOrUnder(pathname, '/manage/users'), label: 'Users', testId: 'root-admin-manage-menu-users', to: '/manage/users' },
      ],
    };
  }
  return null;
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
  'unmapped-participants': 'Unmapped participants',
  map: 'Map competitor',
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
  events: (sport: Sport) => upperFirst(getSportDefinition(sport).vocabulary.event.many),
  participants: (sport: Sport) => upperFirst(getSportDefinition(sport).vocabulary.participant.many),
} as const satisfies Record<string, (sport: Sport) => string>;

function isSportListSegment(segment: string): segment is keyof typeof SPORT_LIST_LABELS {
  return Object.hasOwn(SPORT_LIST_LABELS, segment);
}

/**
 * The label of the segment at `index` of a path under `/manage`. Under `sports/<sport>/`, the
 * sport reads its name and its lists read the sport's words.
 */
export function getManageBreadcrumbLabel(segments: readonly string[], index: number): string {
  const segment = segments[index];
  const sport = segments[0] === 'sports' ? parseSportPathSegment(segments[1]) : null;
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
