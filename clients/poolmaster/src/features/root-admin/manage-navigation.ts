export type ManageSectionGroup = 'platform' | 'sports' | 'operations';

export type ManageSectionKey =
  | 'content-configuration'
  | 'events'
  | 'golf'
  | 'leagues'
  | 'settings'
  | 'sync'
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
      'Manage the contest templates commissioners start from.',
    to: '/manage/content-configuration',
  },
  {
    key: 'events',
    group: 'operations',
    title: 'Events',
    description:
      'Browse events and view their participant fields.',
    to: '/manage/events',
  },
  {
    key: 'sync',
    group: 'operations',
    title: 'Sync',
    description:
      'Providers, sync history, and manual sync runs.',
    to: '/manage/sync',
  },
  {
    key: 'settings',
    group: 'operations',
    title: 'Settings',
    description:
      'How the app behaves, changeable without a deploy: poll intervals, the ingestion schedule, and who changed them last.',
    to: '/manage/settings',
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
  'sync-config': 'Sync Configuration',
  'run-event-sync': 'Run Event Sync',
  'unmapped-participants': 'Unmapped Competitors',
  'poll-intervals': 'Poll Intervals',
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
