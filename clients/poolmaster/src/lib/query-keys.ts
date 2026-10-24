import type { ContestTemplateEventType } from '@poolmaster/shared/domain';

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
    /** One event's games: what a squares contest's game picker offers (#711). */
    games: (sportEventId: QueryKeyId) => ['poolmaster', 'sport-events', sportEventId, 'games'] as const,
    /** One event's field: the team names a squares game picker shows (#711). */
    field: (sportEventId: QueryKeyId) => ['poolmaster', 'sport-events', sportEventId, 'field'] as const,
    /** One sport league's events: what a contest's event picker offers. */
    bySportLeague: (sportLeagueId: QueryKeyId) =>
      ['poolmaster', 'sport-events', 'sport-league', sportLeagueId] as const,
  },
  contests: {
    all: ['poolmaster', 'league-contests'] as const,
    list: (filters?: ContestListFilters) =>
      filters === undefined
        ? (['poolmaster', 'league-contests'] as const)
        : (['poolmaster', 'league-contests', filters.leagueId] as const),
    detail: (contestId: QueryKeyId) => ['poolmaster', 'contest', contestId] as const,
    /** A contest's leaderboard, opened on one of its events when one is named (#713). */
    leaderboard: (contestId: QueryKeyId, sportEventId?: QueryKeyId) =>
      sportEventId === undefined
        ? (['poolmaster', 'contest', contestId, 'leaderboard'] as const)
        : (['poolmaster', 'contest', contestId, 'leaderboard', sportEventId] as const),
    standings: (contestId: QueryKeyId) => ['poolmaster', 'contest', contestId, 'standings'] as const,
    /** A bracket contest's leaderboard (#721): its own read, not the roster leaderboard. */
    bracketLeaderboard: (contestId: QueryKeyId) => ['poolmaster', 'contest', contestId, 'bracket-leaderboard'] as const,
    /** A pick'em contest's season leaderboard (#718): its own read, every week at once. */
    pickEmLeaderboard: (contestId: QueryKeyId) => ['poolmaster', 'contest', contestId, 'pick-em-leaderboard'] as const,
    survivorLeaderboard: (contestId: QueryKeyId) => ['poolmaster', 'contest', contestId, 'survivor-leaderboard'] as const,
    /** A squares contest's board (#711): its boxes, numbers and winners. */
    squaresBoard: (contestId: QueryKeyId) => ['poolmaster', 'contest', contestId, 'squares-board'] as const,
  },
  managedContests: {
    all: ['poolmaster', 'managed-contest'] as const,
    detail: (contestId: QueryKeyId) => ['poolmaster', 'managed-contest', contestId] as const,
    byLeagueAndContest: (leagueId: QueryKeyId, contestId: QueryKeyId) =>
      ['poolmaster', 'managed-contest', leagueId, contestId] as const,
  },
  /**
   * `listContestConfigTemplates` — one global read (A11), so no pool league in the key. A sport
   * league (`sportLeagueId`) is a filter, not a tenant.
   */
  contestConfigTemplates: {
    all: ['poolmaster', 'contest-config-templates'] as const,
    list: (filters: { sport?: QueryKeyId; sportLeagueId?: QueryKeyId; eventType?: ContestTemplateEventType; active?: boolean }) =>
      ['poolmaster', 'contest-config-templates', filters] as const,
  },
  contestEntries: {
    all: ['poolmaster', 'contest-entries'] as const,
    byContest: (contestId: QueryKeyId) => ['poolmaster', 'contest-entries', contestId] as const,
    detail: (entryId: QueryKeyId) => ['poolmaster', 'contest-entries', entryId] as const,
  },
  selectionStates: {
    all: ['poolmaster', 'selection-state'] as const,
    /** Every entry's room in one contest: what a draw changes all at once. */
    byContest: (contestId: QueryKeyId) => ['poolmaster', 'selection-state', contestId] as const,
    /** One entry's room, on one of the contest's events when one is named (#713). */
    detail: (contestId: QueryKeyId, entryId: QueryKeyId, sportEventId?: QueryKeyId) =>
      sportEventId === undefined
        ? (['poolmaster', 'selection-state', contestId, entryId] as const)
        : (['poolmaster', 'selection-state', contestId, entryId, sportEventId] as const),
  },
  /** A prediction contest entry's game picks on one of its events: a bracket's picks (#721), a pick'em week's (#718). */
  gamePicks: {
    all: ['poolmaster', 'game-picks'] as const,
    detail: (contestId: QueryKeyId, entryId: QueryKeyId, sportEventId: QueryKeyId) =>
      ['poolmaster', 'game-picks', contestId, entryId, sportEventId] as const,
  },
  /** One sport league: a bracket's own round names (#706). */
  sportLeagues: {
    detail: (sportLeagueId: QueryKeyId) => ['poolmaster', 'sport-league', sportLeagueId] as const,
    list: () => ['poolmaster', 'sport-leagues'] as const,
  },
  leagues: {
    all: ['poolmaster', 'leagues'] as const,
    list: ['poolmaster', 'leagues', 'list'] as const,
    /**
     * The league-context entry, addressed by league CODE — the key every league-scoped page
     * uses, because `/league/<leagueCode>` is the route.
     */
    detail: (leagueCode: QueryKeyId) => ['poolmaster', 'league', leagueCode] as const,
    /**
     * The same league context, addressed by league ID (#202).
     *
     * A contest-rooted surface knows the league's id and not its code, so it cannot use
     * `detail`. Both reads return `LeagueContextResponse` and `useLeagueContext` seeds
     * whichever address it did not fetch, so one league never sits in two entries with
     * different content.
     */
    contextById: (leagueId: QueryKeyId) => ['poolmaster', 'league-by-id', leagueId] as const,
    members: (leagueId: QueryKeyId) => ['poolmaster', 'league-members', leagueId] as const,
  },
  leagueTeams: {
    all: ['poolmaster', 'league-teams'] as const,
    byLeague: (leagueId: QueryKeyId) => ['poolmaster', 'league-teams', leagueId] as const,
  },
  championship: {
    all: ['poolmaster', 'championship'] as const,
    byYear: (leagueId: QueryKeyId, year: number) => ['poolmaster', 'championship', leagueId, year] as const,
    years: (leagueId: QueryKeyId) => ['poolmaster', 'championship', leagueId, 'years'] as const,
    summary: (leagueId: QueryKeyId) => ['poolmaster', 'championship', leagueId, 'summary'] as const,
    yearReview: (leagueId: QueryKeyId) => ['poolmaster', 'championship', leagueId, 'year-review'] as const,
    records: (leagueId: QueryKeyId) => ['poolmaster', 'championship', leagueId, 'records'] as const,
    perpetualTrophies: (leagueId: QueryKeyId) => ['poolmaster', 'championship', leagueId, 'perpetual-trophies'] as const,
    squadYear: (leagueId: QueryKeyId, squadId: QueryKeyId, year: number) =>
      ['poolmaster', 'championship', leagueId, year, 'squad', squadId] as const,
    squadHistory: (leagueId: QueryKeyId, squadId: QueryKeyId) =>
      ['poolmaster', 'championship', leagueId, 'squad', squadId] as const,
    contests: (leagueId: QueryKeyId, year: number | null, squadId: QueryKeyId | null, place: number | null) =>
      ['poolmaster', 'championship', leagueId, year, 'contests', squadId, place] as const,
  },
  cups: {
    all: ['poolmaster', 'cups'] as const,
    bySeason: (leagueId: QueryKeyId, seasonYear: number) =>
      ['poolmaster', 'cups', leagueId, seasonYear] as const,
    seasons: (leagueId: QueryKeyId) => ['poolmaster', 'cups', leagueId, 'seasons'] as const,
    squadPoints: (leagueId: QueryKeyId, cupId: QueryKeyId, squadId: QueryKeyId) =>
      ['poolmaster', 'cups', leagueId, 'squad-points', cupId, squadId] as const,
    projection: (leagueId: QueryKeyId, cupId: QueryKeyId) =>
      ['poolmaster', 'cups', leagueId, 'projection', cupId] as const,
  },
  leagueInvitations: {
    byLeague: (leagueId: QueryKeyId) => ['poolmaster', 'league-invitations', leagueId] as const,
  },
  leagueTeamOwnerInvitations: {
    all: ['poolmaster', 'league-team-owner-invitations'] as const,
    byLeague: (leagueId: QueryKeyId) =>
      ['poolmaster', 'league-team-owner-invitations', leagueId] as const,
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
  emailPreferences: {
    detail: (userId: QueryKeyId) => ['poolmaster', 'email-preferences', userId] as const,
  },
  users: {
    all: ['poolmaster', 'admin', 'user-detail'] as const,
    detail: (userId: QueryKeyId) => ['poolmaster', 'admin', 'user-detail', userId] as const,
  },
  rootAdmin: {
    all: ['poolmaster', 'root-admin'] as const,
    eventParticipants: (eventId: QueryKeyId) =>
      ['poolmaster', 'root-admin', 'events', eventId, 'participants'] as const,
    eventSyncEvents: (sport: QueryKeyId) =>
      ['poolmaster', 'root-admin', 'event-sync-events', sport] as const,
    events: ['poolmaster', 'root-admin', 'events'] as const,
    // The Manage sport screens (golf's first, every sport's since #623). Lists of one sport take
    // the sport; invalidating the bare prefix (`leagues`, `events`, `participants`) refreshes every
    // sport's.
    manageSport: {
      all: ['poolmaster', 'root-admin', 'manage-sport'] as const,
      sport: (sport: QueryKeyId) => ['poolmaster', 'root-admin', 'manage-sport', 'sport', sport] as const,
      leagues: ['poolmaster', 'root-admin', 'manage-sport', 'leagues'] as const,
      sportLeagues: (sport: QueryKeyId) => ['poolmaster', 'root-admin', 'manage-sport', 'leagues', sport] as const,
      // Deliberately NOT nested under the `leagues` prefix: invalidating the
      // `leagues` list (a league rename / active toggle) must not also wipe every
      // league's roster cache, since TanStack invalidation is prefix-match.
      leagueRoster: (sportLeagueId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'league-roster', sportLeagueId] as const,
      events: ['poolmaster', 'root-admin', 'manage-sport', 'events'] as const,
      sportEvents: (sport: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'events', 'sport', sport] as const,
      // Under the `events` prefix, so invalidating the list refreshes each league's too.
      leagueEvents: (sportLeagueId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'events', 'league', sportLeagueId] as const,
      event: (eventId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'event', eventId] as const,
      rounds: (eventId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'event', eventId, 'rounds'] as const,
      field: (eventId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'event', eventId, 'field'] as const,
      tiers: (eventId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'event', eventId, 'tiers'] as const,
      bracket: (eventId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'event', eventId, 'bracket'] as const,
      // Under the bracket, so a result that changes who is left refreshes the suggestion too.
      reseedProposal: (eventId: QueryKeyId, roundNumber: number) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'event', eventId, 'bracket', 'reseed', roundNumber] as const,
      liveSimulation: (eventId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'event', eventId, 'live-simulation'] as const,
      participants: ['poolmaster', 'root-admin', 'manage-sport', 'participants'] as const,
      participantList: (sport: QueryKeyId, status?: string) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'participants', sport, 'list', status ?? 'ACTIVE'] as const,
      participantSearch: (sport: QueryKeyId, search: string) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'participants', sport, 'search', search] as const,
      participant: (participantId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'participant', participantId] as const,
      participantMappings: (participantId: QueryKeyId) =>
        ['poolmaster', 'root-admin', 'manage-sport', 'participant', participantId, 'provider-mappings'] as const,
    },
    // plans/124 §6.4. `dateWindow` extends the documented (providerId, sport,
    // search) signature: both callers (create browse, Home score-source picker)
    // go through useProviderCatalog, which always passes a
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
    manageUsers: ['poolmaster', 'root-admin', 'manage-users'] as const,
    providers: ['poolmaster', 'root-admin', 'providers'] as const,
    // Every settings group (#450). History sits under the same prefix, so invalidating
    // `settings` after any save refreshes each group's recent changes too.
    settings: ['poolmaster', 'root-admin', 'settings'] as const,
    settingsHistory: (key: QueryKeyId) =>
      ['poolmaster', 'root-admin', 'settings', key, 'history'] as const,
    providerSyncRuns: ['poolmaster', 'root-admin', 'provider-sync-runs'] as const,
    unmappedProviderParticipants: ['poolmaster', 'root-admin', 'unmapped-provider-participants'] as const,
    participantCandidates: (sportId: QueryKeyId, search: QueryKeyId) =>
      ['poolmaster', 'root-admin', 'participant-candidates', sportId, search] as const,
    users: ['poolmaster', 'root-admin', 'users'] as const,
  },
} as const;
