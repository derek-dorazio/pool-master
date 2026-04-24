export type ManageSectionKey =
  | 'content-configuration'
  | 'leagues'
  | 'sync'
  | 'sync-config'
  | 'teams'
  | 'users';

export type ManageSectionDefinition = {
  key: ManageSectionKey;
  title: string;
  description: string;
  to: string;
  availability: 'live' | 'legacy' | 'blocked';
  availabilityLabel: string;
  legacyHref?: string;
};

export const MANAGE_SECTION_DEFINITIONS: ManageSectionDefinition[] = [
  {
    key: 'leagues',
    title: 'Leagues',
    description:
      'Search leagues and open the canonical League Home to act on them. Commissioner and root-admin lifecycle controls live on League Home under authority-gated sections.',
    to: '/manage/leagues',
    availability: 'live',
    availabilityLabel: 'Live now',
  },
  {
    key: 'teams',
    title: 'Teams',
    description:
      'Cross-league team admin search is waiting on the backend contract, so this section is staged but not yet operational.',
    to: '/manage/teams',
    availability: 'blocked',
    availabilityLabel: 'Blocked by backend',
  },
  {
    key: 'users',
    title: 'Users',
    description:
      'Search user accounts and move into canonical user pages for root-admin account actions.',
    to: '/manage/users',
    availability: 'live',
    availabilityLabel: 'Live now',
  },
  {
    key: 'content-configuration',
    title: 'Content Configuration',
    description:
      'Manage the persisted global contest-default templates used by future commissioner create flows.',
    to: '/manage/content-configuration',
    availability: 'live',
    availabilityLabel: 'Live now',
  },
  {
    key: 'sync',
    title: 'Sync',
    description:
      'Provider visibility, sync history, and manual run actions now live in dedicated operational pages.',
    to: '/manage/sync',
    availability: 'live',
    availabilityLabel: 'Live now',
  },
  {
    key: 'sync-config',
    title: 'Sync Configuration',
    description:
      'Poll intervals, ingestion schedule, and sport overrides now live in dedicated edit pages.',
    to: '/manage/sync-config',
    availability: 'live',
    availabilityLabel: 'Live now',
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

export function getManageBreadcrumbLabel(segment: string): string {
  if (segment === 'manage') {
    return 'Manage';
  }

  if (segment === 'legacy') {
    return 'Legacy Manage Surface';
  }

  if (segment === 'run-sport-sync') {
    return 'Run Sport Sync';
  }

  if (segment === 'run-event-sync') {
    return 'Run Event Sync';
  }

  if (segment === 'poll-intervals') {
    return 'Poll Intervals';
  }

  if (segment === 'ingestion-schedule') {
    return 'Global Ingestion Schedule';
  }

  if (segment === 'sport-overrides') {
    return 'Sport Ingestion Overrides';
  }

  const section = MANAGE_SECTION_DEFINITIONS.find(
    (candidate) => candidate.key === segment,
  );
  if (section) {
    return section.title;
  }

  return decodeURIComponent(segment);
}
