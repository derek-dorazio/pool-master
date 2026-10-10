import type { NavMenuItem } from '@/features/shared/ui';

export type ManageSectionGroup = 'platform' | 'sports' | 'operations';

export type ManageSectionKey =
  | 'content-configuration'
  | 'events'
  | 'golf'
  | 'leagues'
  | 'settings'
  | 'sync'
  | 'users';

type ManageSectionDefinition = {
  key: ManageSectionKey;
  group: ManageSectionGroup;
  title: string;
  to: string;
};

const MANAGE_SECTION_GROUP_TITLES: Record<ManageSectionGroup, string> = {
  platform: 'Platform',
  sports: 'Sports',
  operations: 'Operations',
};

/** The Manage side menu, in order; items of one group sit together under its heading. */
const MANAGE_SECTION_DEFINITIONS: ManageSectionDefinition[] = [
  { key: 'leagues', group: 'platform', title: 'Leagues', to: '/manage/leagues' },
  { key: 'users', group: 'platform', title: 'Users', to: '/manage/users' },
  { key: 'golf', group: 'sports', title: 'Golf', to: '/manage/golf' },
  {
    key: 'content-configuration',
    group: 'operations',
    title: 'Content Configuration',
    to: '/manage/content-configuration',
  },
  { key: 'events', group: 'operations', title: 'Events', to: '/manage/events' },
  { key: 'sync', group: 'operations', title: 'Sync', to: '/manage/sync' },
  { key: 'settings', group: 'operations', title: 'Settings', to: '/manage/settings' },
];

/** Where `/manage` itself lands: the first section of the menu. */
export const MANAGE_LANDING_PATH = '/manage/leagues';

/** Rows per page on every Manage list (rules/ux-rules.md §12 rule 7). */
export const MANAGE_LIST_PAGE_SIZE = 25;

export function buildManageUserPath(userId: string) {
  return `/manage/users/${userId}`;
}

function isAtOrUnder(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function buildManageMenuItems(pathname: string): NavMenuItem[] {
  return MANAGE_SECTION_DEFINITIONS.map((section) => ({
    group: MANAGE_SECTION_GROUP_TITLES[section.group],
    isActive: isAtOrUnder(pathname, section.to),
    label: section.title,
    testId: `root-admin-manage-menu-${section.key}`,
    to: section.to,
  }));
}

const STATIC_BREADCRUMB_LABELS: Record<string, string> = {
  'sync-config': 'Sync Configuration',
  'run-event-sync': 'Run Event Sync',
  'unmapped-participants': 'Unmapped Competitors',
  'ingestion-schedule': 'Global Ingestion Schedule',
  'sport-overrides': 'Sport Ingestion Overrides',
  golf: 'Golf',
  tours: 'Tours',
  tournaments: 'Tournaments',
  players: 'Players',
  field: 'Field',
  tiers: 'Tiers',
  scores: 'Scores',
  new: 'New',
};

export function getManageBreadcrumbLabel(segment: string): string {
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
