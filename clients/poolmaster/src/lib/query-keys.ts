type QueryKeyId = string | null | undefined;

type SportEventListFilters = {
  readonly sport?: QueryKeyId;
  readonly status?: QueryKeyId;
};

type ContestListFilters = {
  readonly leagueId?: QueryKeyId;
};

export const QueryKeys = {
  sports: {
    all: ['poolmaster', 'sports'] as const,
    list: ['poolmaster', 'sports'] as const,
    detail: (sportId: QueryKeyId) => ['poolmaster', 'sports', sportId] as const,
  },
  sportEvents: {
    all: ['poolmaster', 'sport-events'] as const,
    list: (filters?: SportEventListFilters) => {
      if (!filters) {
        return ['poolmaster', 'sport-events'] as const;
      }

      const hasSport = Object.hasOwn(filters, 'sport');
      const hasStatus = Object.hasOwn(filters, 'status');
      const { sport, status } = filters;

      if (hasSport && hasStatus) {
        return ['poolmaster', 'sport-events', { sport, status }] as const;
      }

      if (hasSport) {
        return ['poolmaster', 'sport-events', sport] as const;
      }

      if (hasStatus) {
        return ['poolmaster', 'sport-events', { status }] as const;
      }

      return ['poolmaster', 'sport-events'] as const;
    },
    detail: (sportEventId: QueryKeyId) => ['poolmaster', 'sport-events', sportEventId] as const,
  },
  contests: {
    all: ['poolmaster', 'league-contests'] as const,
    list: (filters?: ContestListFilters) =>
      filters === undefined
        ? (['poolmaster', 'league-contests'] as const)
        : (['poolmaster', 'league-contests', filters.leagueId] as const),
    detail: (contestId: QueryKeyId) => ['poolmaster', 'contest', contestId] as const,
    myEntries: (leagueId: QueryKeyId, contestIds: readonly string[]) =>
      ['poolmaster', 'league-contests', leagueId, 'my-entries', contestIds] as const,
    standings: (contestId: QueryKeyId) => ['poolmaster', 'contest', contestId, 'standings'] as const,
  },
  managedContests: {
    all: ['poolmaster', 'managed-contest'] as const,
    detail: (contestId: QueryKeyId) => ['poolmaster', 'managed-contest', contestId] as const,
    byLeagueAndContest: (leagueId: QueryKeyId, contestId: QueryKeyId) =>
      ['poolmaster', 'managed-contest', leagueId, contestId] as const,
    templates: (
      leagueId: QueryKeyId,
      sport: QueryKeyId,
      contestFormat: QueryKeyId,
    ) => ['poolmaster', 'managed-contest-templates', leagueId, sport, contestFormat] as const,
  },
  contestEntries: {
    all: ['poolmaster', 'contest-entries'] as const,
    byContest: (contestId: QueryKeyId) => ['poolmaster', 'contest-entries', contestId] as const,
    detail: (entryId: QueryKeyId) => ['poolmaster', 'contest-entries', entryId] as const,
    me: (contestId: QueryKeyId) => ['poolmaster', 'contest-entries', contestId, 'me'] as const,
  },
  contestLeagueCodes: {
    all: ['poolmaster', 'contest-league-code'] as const,
    byLeagueId: (leagueId: QueryKeyId) =>
      ['poolmaster', 'contest-league-code', leagueId] as const,
  },
  draftStates: {
    all: ['poolmaster', 'draft-state'] as const,
    detail: (contestId: QueryKeyId, entryId: QueryKeyId) =>
      ['poolmaster', 'draft-state', contestId, entryId] as const,
  },
  leagues: {
    all: ['poolmaster', 'leagues'] as const,
    list: ['poolmaster', 'leagues'] as const,
    detail: (leagueId: QueryKeyId) => ['poolmaster', 'league', leagueId] as const,
    dashboard: (leagueId: QueryKeyId) => ['poolmaster', 'league', leagueId, 'dashboard'] as const,
    manage: (leagueId: QueryKeyId) => ['poolmaster', 'league', leagueId, 'manage'] as const,
    members: (leagueId: QueryKeyId) => ['poolmaster', 'league-members', leagueId] as const,
  },
  leagueTeams: {
    all: ['poolmaster', 'league-teams'] as const,
    byLeague: (leagueId: QueryKeyId) => ['poolmaster', 'league-teams', leagueId] as const,
  },
  leagueTeamOwnerInvitations: {
    all: ['poolmaster', 'league-team-owner-invitations'] as const,
    byLeague: (leagueId: QueryKeyId) =>
      ['poolmaster', 'league-team-owner-invitations', leagueId] as const,
  },
  myTeamHistory: {
    all: ['poolmaster', 'my-team-history'] as const,
    byTeamAndContests: (teamId: QueryKeyId, contestIds: QueryKeyId) =>
      ['poolmaster', 'my-team-history', teamId, contestIds] as const,
  },
  invitations: {
    all: ['poolmaster', 'invitation-preview'] as const,
    leaguePreview: (inviteCode: QueryKeyId) =>
      ['poolmaster', 'invitation-preview', inviteCode] as const,
    teamOwnerPreview: (inviteCode: QueryKeyId) =>
      ['poolmaster', 'team-owner-invitation-preview', inviteCode] as const,
  },
  auth: {
    all: ['poolmaster', 'auth'] as const,
    me: ['poolmaster', 'auth', 'me'] as const,
    refresh: ['poolmaster', 'auth', 'refresh'] as const,
  },
  users: {
    all: ['poolmaster', 'admin', 'user-detail'] as const,
    detail: (userId: QueryKeyId) => ['poolmaster', 'admin', 'user-detail', userId] as const,
  },
  rootAdmin: {
    all: ['poolmaster', 'root-admin'] as const,
    contestConfigTemplates: ['poolmaster', 'root-admin', 'contest-config-templates'] as const,
    eventSyncEvents: (sport: QueryKeyId) =>
      ['poolmaster', 'root-admin', 'event-sync-events', sport] as const,
    ingestionConfig: ['poolmaster', 'root-admin', 'ingestion-config'] as const,
    manageLeagues: ['poolmaster', 'root-admin', 'manage-leagues'] as const,
    manageTeams: ['poolmaster', 'root-admin', 'manage-teams'] as const,
    manageUsers: ['poolmaster', 'manage', 'users'] as const,
    pollConfig: ['poolmaster', 'root-admin', 'poll-config'] as const,
    providers: ['poolmaster', 'root-admin', 'providers'] as const,
    providerSyncRuns: ['poolmaster', 'root-admin', 'provider-sync-runs'] as const,
    users: ['poolmaster', 'root-admin', 'users'] as const,
  },
} as const;
