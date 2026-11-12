import { SUPPORTED_SPORTS, getSportDefinition, sportPathSegment, type Sport } from '@poolmaster/shared/domain';
import type { PageLinkTab } from '@/features/shared/ui';
import { upperFirst } from '@/lib/upper-first';

type ManageSectionDefinition = {
  /** The tab's selector suffix and its path segment under `/manage`. */
  key: string;
  title: string;
  to: string;
};

/** The supported sport a URL segment names, or null when it names none. */
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

export function buildSportParticipantListPath(sport: Sport) {
  return `${buildSportPath(sport)}/participants`;
}

export function buildSportParticipantPath(sport: Sport, participantId: string) {
  return `${buildSportParticipantListPath(sport)}/${participantId}`;
}

export function buildSportLeagueListPath(sport: Sport) {
  return `${buildSportPath(sport)}/leagues`;
}

export function buildSportLeaguePath(sport: Sport, sportLeagueId: string) {
  return `${buildSportLeagueListPath(sport)}/${sportLeagueId}`;
}

/** Where `/manage/sports` itself lands: the first supported sport's events. */
export const SPORTS_LANDING_PATH = buildSportEventListPath(SUPPORTED_SPORTS[0]);

/** Manage's tools, one top tab each, in order (#1620). */
const MANAGE_SECTION_DEFINITIONS: ManageSectionDefinition[] = [
  { key: 'leagues', title: 'Leagues', to: '/manage/leagues' },
  { key: 'users', title: 'Users', to: '/manage/users' },
  { key: 'plans', title: 'Plans', to: '/manage/plans' },
  { key: 'sports', title: 'Sports', to: SPORTS_PATH },
  { key: 'events', title: 'Events', to: '/manage/events' },
  { key: 'sync', title: 'Sync', to: '/manage/sync' },
  { key: 'settings', title: 'Settings', to: '/manage/settings' },
  { key: 'content-configuration', title: 'Content', to: '/manage/content-configuration' },
];

/** Where `/manage` itself lands: the first section of the menu. */
export const MANAGE_LANDING_PATH = '/manage/leagues';

/** Rows per page on every Manage list (rules/ux-rules.md §12 rule 7). */
export const MANAGE_LIST_PAGE_SIZE = 25;

/** How long a server-searched Manage list waits after the last key before it asks (#1180). */
export const SEARCH_DEBOUNCE_MS = 300;

export function buildManageUserPath(userId: string) {
  return `/manage/users/${userId}`;
}

export const SETTINGS_PATH = '/manage/settings';

export const PLANS_PATH = '/manage/plans';

export const SYNC_PATH = '/manage/sync';

export const UNMAPPED_COMPETITORS_PATH = `${SYNC_PATH}/unmapped-participants`;

/** The page that maps one unmapped competitor; a provider's id can hold any character. */
export function buildMapCompetitorPath(providerId: string, externalId: string) {
  const query = new URLSearchParams({ provider: providerId, competitor: externalId });
  return `${UNMAPPED_COMPETITORS_PATH}/map?${query.toString()}`;
}

function isAtOrUnder(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Manage's top tabs; a tool's sub-pages keep its tab lit. */
export function buildManageTabs(pathname: string): PageLinkTab[] {
  return MANAGE_SECTION_DEFINITIONS.map((section) => ({
    isActive: isAtOrUnder(pathname, section.to),
    label: section.title,
    testId: `root-admin-manage-menu-${section.key}`,
    to: section.to,
  }));
}

/**
 * Under Sports, the second row: one tab per supported sport, in enum order, named by its
 * definition. Null anywhere else.
 */
export function buildManageSportTabs(pathname: string): PageLinkTab[] | null {
  if (!isAtOrUnder(pathname, SPORTS_PATH)) {
    return null;
  }
  return SUPPORTED_SPORTS.map((sport) => ({
    isActive: isAtOrUnder(pathname, buildSportPath(sport)),
    label: getSportDefinition(sport).name,
    testId: `root-admin-manage-menu-${sportPathSegment(sport)}`,
    to: buildSportPath(sport),
  }));
}

const STATIC_BREADCRUMB_LABELS: Record<string, string> = {
  'run-event-sync': 'Run Event Sync',
  'unmapped-participants': 'Unmapped Competitors',
  map: 'Map competitor',
  'ingestion-schedule': 'Global Ingestion Schedule',
  'sport-overrides': 'Sport Ingestion Overrides',
  field: 'Field',
  tiers: 'Tiers',
  results: 'Results',
  new: 'New',
  edit: 'Edit details',
  schedule: 'Schedule',
};

/** A sport's three lists, labelled in the sport's own words: "Tournaments", "Golfers", "Tours". */
const SPORT_LIST_LABELS = {
  events: (sport: Sport) => upperFirst(getSportDefinition(sport).vocabulary.event.many),
  participants: (sport: Sport) => upperFirst(getSportDefinition(sport).vocabulary.participant.many),
  leagues: (sport: Sport) => upperFirst(getSportDefinition(sport).vocabulary.sportLeague.many),
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
