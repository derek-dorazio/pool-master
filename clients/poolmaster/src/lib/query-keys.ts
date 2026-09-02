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
    list: ['poolmaster', 'sports', 'list'] as const,
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
    list: ['poolmaster', 'leagues', 'list'] as const,
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
    eventParticipants: (eventId: QueryKeyId) =>
      ['poolmaster', 'root-admin', 'events', eventId, 'participants'] as const,
    eventSyncEvents: (sport: QueryKeyId) =>
      ['poolmaster', 'root-admin', 'event-sync-events', sport] as const,
    events: ['poolmaster', 'root-admin', 'events'] as const,
    golf: {
      all: ['poolmaster', 'root-admin', 'golf'] as const,
      tours: ['poolmaster', 'root-admin', 'golf', 'tours'] as const,
      // Deliberately NOT nested under the `tours` prefix: invalidating the
      // `tours` list (a tour rename / active toggle) must not also wipe every
      // tour's roster cache, since TanStack invalidation is prefix-match.
      leagueRoster: (sportLeagueId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'golf', 'league-roster', sportLeagueId] as const,
      seasons: (sportLeagueId?: QueryKeyId) =>
        sportLeagueId === undefined
          ? (['poolmaster', 'root-admin', 'golf', 'seasons'] as const)
          : (['poolmaster', 'root-admin', 'golf', 'seasons', sportLeagueId] as const),
      season: (seasonId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'golf', 'season', seasonId] as const,
      tournaments: ['poolmaster', 'root-admin', 'golf', 'tournaments'] as const,
      tournament: (eventId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'golf', 'tournament', eventId] as const,
      rounds: (eventId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'golf', 'tournament', eventId, 'rounds'] as const,
      field: (eventId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'golf', 'tournament', eventId, 'field'] as const,
      tiers: (eventId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'golf', 'tournament', eventId, 'tiers'] as const,
      roundScores: (eventId: QueryKeyId, round: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'golf', 'tournament', eventId, 'round-scores', round] as const,
      players: ['poolmaster', 'root-admin', 'golf', 'players'] as const,
      playerSearch: (search: string) =>
        ['poolmaster', 'root-admin', 'golf', 'players', 'search', search] as const,
      player: (participantId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'golf', 'player', participantId] as const,
    },
    // plans/124 §6.4. `dateWindow` extends the documented (providerId, sport,
    // search) signature: both callers (create browse, Home score-source picker)
    // go through useGolfProviderCatalog, which always passes a
    // `${from}|${to}|${sportLeagueId}` string so the from/to/league filters are
    // part of the cache identity, not just the search term.
    providerCatalogEvents: (
      providerId: QueryKeyId,
      sport: QueryKeyId,
      search: QueryKeyId,
      dateWindow?: QueryKeyId,
    ) =>
      [
        'poolmaster',
        'root-admin',
        'provider-catalog-events',
        providerId,
        sport,
        search,
        dateWindow ?? null,
      ] as const,
    ingestionConfig: ['poolmaster', 'root-admin', 'ingestion-config'] as const,
    manageLeagues: ['poolmaster', 'root-admin', 'manage-leagues'] as const,
    manageTeams: ['poolmaster', 'root-admin', 'manage-teams'] as const,
    manageUsers: ['poolmaster', 'root-admin', 'manage-users'] as const,
    pollConfig: ['poolmaster', 'root-admin', 'poll-config'] as const,
    providers: ['poolmaster', 'root-admin', 'providers'] as const,
    providerSyncRuns: ['poolmaster', 'root-admin', 'provider-sync-runs'] as const,
    users: ['poolmaster', 'root-admin', 'users'] as const,
  },
} as const;
