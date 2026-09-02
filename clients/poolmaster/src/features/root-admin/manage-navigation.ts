export type ManageSectionGroup = 'platform' | 'sports' | 'operations';

export type ManageSectionKey =
  | 'content-configuration'
  | 'events'
  | 'golf'
  | 'leagues'
  | 'sync'
  | 'sync-config'
  | 'teams'
  | 'users';

export type ManageSectionDefinition = {
  key: ManageSectionKey;
  group: ManageSectionGroup;
  title: string;
  description: string;
  to: string;
};

export const MANAGE_SECTION_GROUP_ORDER: ReadonlyArray<{
  group: ManageSectionGroup;
  title: string;
}> = [
  { group: 'platform', title: 'Platform' },
  { group: 'sports', title: 'Sports' },
  { group: 'operations', title: 'Operations' },
];

export const MANAGE_SECTION_DEFINITIONS: ManageSectionDefinition[] = [
  {
    key: 'leagues',
    group: 'platform',
    title: 'Leagues',
    description:
      'Search leagues and open League Home to manage league details, members, and lifecycle actions.',
    to: '/manage/leagues',
  },
  {
    key: 'teams',
    group: 'platform',
    title: 'Teams',
    description:
      'Search teams across leagues, then open Team Home for owner and lifecycle actions.',
    to: '/manage/teams',
  },
  {
    key: 'users',
    group: 'platform',
    title: 'Users',
    description:
      'Search user accounts and open user pages for root-admin account actions.',
    to: '/manage/users',
  },
  {
    key: 'golf',
    group: 'sports',
    title: 'Golf',
    description:
      'Create and run golf tournaments: field, tiers, workflow, and scores.',
    to: '/manage/golf',
  },
  {
    key: 'content-configuration',
    group: 'operations',
    title: 'Content Configuration',
    description:
      'Manage the persisted contest templates available to commissioner contest setup.',
    to: '/manage/content-configuration',
  },
  {
    key: 'events',
    group: 'operations',
    title: 'Events',
    description:
      'Browse current persisted event state and open read-only participant fields for sync QA.',
    to: '/manage/events',
  },
  {
    key: 'sync',
    group: 'operations',
    title: 'Sync',
    description:
      'Provider visibility, sync history, and manual run actions now live in dedicated operational pages.',
    to: '/manage/sync',
  },
  {
    key: 'sync-config',
    group: 'operations',
    title: 'Sync Configuration',
    description:
      'Poll intervals, ingestion schedule, and sport overrides now live in dedicated edit pages.',
    to: '/manage/sync-config',
  },
];

export function getManageSectionDefinition(
  key: ManageSectionKey,
): ManageSectionDefinition {
  const section = MANAGE_SECTION_DEFINITIONS.find((candidate) => candidate.key === key);

  if (!section) {
    throw new Error(`Unknown manage section key: ${key}`);
  }

  return section;
}

export function getManageSectionsByGroup(
  group: ManageSectionGroup,
): ManageSectionDefinition[] {
  return MANAGE_SECTION_DEFINITIONS.filter((section) => section.group === group);
}

const STATIC_BREADCRUMB_LABELS: Record<string, string> = {
  manage: 'Manage',
  'run-sport-sync': 'Run Sport Sync',
  'run-event-sync': 'Run Event Sync',
  'poll-intervals': 'Poll Intervals',
  'ingestion-schedule': 'Global Ingestion Schedule',
  'sport-overrides': 'Sport Ingestion Overrides',
  golf: 'Golf',
  tours: 'Tours',
  seasons: 'Seasons',
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
