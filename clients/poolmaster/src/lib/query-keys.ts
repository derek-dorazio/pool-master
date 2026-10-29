import type { ContestTemplateEventType } from '@poolmaster/shared/domain';

type QueryKeyId = string | null | undefined;

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
    /** A sport's events that can still take a contest: what contest setup chooses from. */
    offerable: (sport: QueryKeyId) => ['poolmaster', 'sport-events', 'offerable', sport] as const,
    detail: (sportEventId: QueryKeyId) => ['poolmaster', 'sport-events', sportEventId] as const,
    /** One event's games: what a squares contest's game picker offers (#711). */
    games: (sportEventId: QueryKeyId) => ['poolmaster', 'sport-events', sportEventId, 'games'] as const,
    /** One event's field: the team names a squares game picker shows (#711). */
    field: (sportEventId: QueryKeyId) => ['poolmaster', 'sport-events', sportEventId, 'field'] as const,
    /** One sport league's events in one event year: what a contest's event picker offers. */
    bySportLeagueYear: (sportLeagueId: QueryKeyId, eventYear: number) =>
      ['poolmaster', 'sport-events', 'sport-league', sportLeagueId, eventYear] as const,
    /** The event years one sport league has events in: the event picker's seasons. */
    yearsBySportLeague: (sportLeagueId: QueryKeyId) =>
      ['poolmaster', 'sport-events', 'sport-league', sportLeagueId, 'years'] as const,
  },
  contests: {
    all: ['poolmaster', 'league-contests'] as const,
    list: (filters?: ContestListFilters) =>
      filters === undefined
        ? (['poolmaster', 'league-contests'] as const)
        : (['poolmaster', 'league-contests', filters.leagueId] as const),
    /** One year's finished contests (#1161); under the league's list key, so invalidating it covers them. */
    finished: (leagueId: QueryKeyId, year: number | null) => ['poolmaster', 'league-contests', leagueId, 'finished', year] as const,
    /** The years a league has finished contests in (#1161). */
    finishedYears: (leagueId: QueryKeyId) => ['poolmaster', 'league-contests', leagueId, 'finished-years'] as const,
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
  /** A contest's entry cap and the expansions its commissioners can choose (#987). */
  contestExpansions: {
    all: ['poolmaster', 'contest-expansion'] as const,
    detail: (leagueId: QueryKeyId, contestId: QueryKeyId) => ['poolmaster', 'contest-expansion', leagueId, contestId] as const,
  },
  /** Payment history lines (#987): a league's, for its commissioners, and the signed-in user's own. */
  payments: {
    all: ['poolmaster', 'payments'] as const,
    league: (leagueId: QueryKeyId) => ['poolmaster', 'payments', 'league', leagueId] as const,
    mine: ['poolmaster', 'payments', 'mine'] as const,
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
    /** One entry (#1197); under its contest's key, so invalidating the contest's entries covers it. */
    detail: (contestId: QueryKeyId, entryId: QueryKeyId) => ['poolmaster', 'contest-entries', contestId, entryId] as const,
    /** Every league's "my entries" (#1197): what an entry write invalidates without knowing the league. */
    allMine: ['poolmaster', 'contest-entries', 'mine'] as const,
    /** The viewer's entries across one league's current contests (#1197). */
    mine: (leagueId: QueryKeyId) => ['poolmaster', 'contest-entries', 'mine', leagueId] as const,
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
  /** The public event pages (#1007): one by its address, and the active ones of a sport or all. */
  eventPages: {
    detail: (sport: string, pageSlug: string) => ['poolmaster', 'event-pages', sport, pageSlug] as const,
    list: (sport: string | null, upcoming: boolean) => ['poolmaster', 'event-pages', 'list', sport, upcoming] as const,
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
    /** One team (#1165). Under `byLeague`, so a write that refreshes the list refreshes it too. */
    detail: (leagueId: QueryKeyId, squadId: QueryKeyId) => ['poolmaster', 'league-teams', leagueId, squadId] as const,
  },
  /** Every plan's caps and features: the commissioner's comparison table (#945). */
  plans: {
    list: ['poolmaster', 'plans'] as const,
    sportLeaguesUsedAll: (leagueId: QueryKeyId) => ['poolmaster', 'plans', 'sport-leagues-used', leagueId] as const,
    sportLeaguesUsed: (leagueId: QueryKeyId, seasonYear: number) => ['poolmaster', 'plans', 'sport-leagues-used', leagueId, seasonYear] as const,
    /** What a league uses of its plan's caps now (#972): the commissioner Plan page. */
    usage: (leagueId: QueryKeyId) => ['poolmaster', 'plans', 'usage', leagueId] as const,
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
    /** One squad's points in the season's cup for a sports league (#1202). Under `bySeason`. */
    squadPoints: (leagueId: QueryKeyId, seasonYear: number, sportLeagueId: QueryKeyId, squadId: QueryKeyId) =>
      ['poolmaster', 'cups', leagueId, seasonYear, 'squad-points', sportLeagueId, squadId] as const,
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
    eventsByYear: (eventYear: number) => ['poolmaster', 'root-admin', 'events', 'year', eventYear] as const,
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
    // The search term is part of the key (#1180); invalidating the bare prefix refreshes every search.
    manageLeagues: ['poolmaster', 'root-admin', 'manage-leagues'] as const,
    manageLeaguesSearch: (search: string) => ['poolmaster', 'root-admin', 'manage-leagues', search] as const,
    manageUsersSearch: (search: string) => ['poolmaster', 'root-admin', 'manage-users', search] as const,
    providers: ['poolmaster', 'root-admin', 'providers'] as const,
    // Every settings group (#450). History sits under the same prefix, so invalidating
    // `settings` after any save refreshes each group's recent changes too.
    settings: ['poolmaster', 'root-admin', 'settings'] as const,
    settingsHistory: (key: QueryKeyId) =>
      ['poolmaster', 'root-admin', 'settings', key, 'history'] as const,
    providerSyncRuns: ['poolmaster', 'root-admin', 'provider-sync-runs'] as const,
    // Under the list's prefix, so refreshing the list refreshes an open run's details too.
    providerSyncRun: (syncRunId: QueryKeyId) =>
      ['poolmaster', 'root-admin', 'provider-sync-runs', syncRunId] as const,
    unmappedProviderParticipants: ['poolmaster', 'root-admin', 'unmapped-provider-participants'] as const,
    participantCandidates: (sportId: QueryKeyId, search: QueryKeyId) =>
      ['poolmaster', 'root-admin', 'participant-candidates', sportId, search] as const,
    users: ['poolmaster', 'root-admin', 'users'] as const,
  },
} as const;
