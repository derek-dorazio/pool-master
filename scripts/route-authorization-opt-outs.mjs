/**
 * #193 — the by-id routes that declare no `preHandler` or `onRequest` hook, and where each one
 * authorizes instead. Read by `scripts/check-route-authorization.mjs`; the rule and its reasoning
 * are in that file's header.
 *
 * A hook is the default. Authorizing in the handler or service is the declared exception, taken
 * when the check needs what a hook cannot see — the request body, or which sub-resource is being
 * acted on — or when the service already takes the actor and enforces the rule itself. Each
 * entry says which, in one line, naming the function that does the work.
 *
 * An entry is also how a known gap stays visible until it is fixed: a route that authorizes
 * NOWHERE is listed as such with the issue that owes it a gate, rather than passing silently.
 * Fixing one means adding the hook and deleting the entry; the scanner fails if a route declares
 * a hook and still has an entry here, or if an entry names no route.
 *
 * Keys are `METHOD /full/path`, exactly as the scanner prints them.
 */
export const ROUTE_AUTHORIZATION_OPT_OUTS = [
  // --- Contests: entries act for the caller's own squad, resolved in ContestService ---
  {
    route: 'POST /api/v1/contests/:contestId/entries/me',
    reason: 'Acts for the caller\'s own squad: ContestService.createEntry requires league membership and an ACTIVE squad membership (requireSquadForEntry) and derives the squad from them.',
  },
  {
    route: 'DELETE /api/v1/contests/:contestId/entries/me',
    reason: 'Acts for the caller\'s own squad: ContestService.deleteMyEntry requires a league and squad membership and deletes only that squad\'s entry. Membership status is unchecked: #291.',
  },
  {
    route: 'PATCH /api/v1/contests/:contestId/entries/:entryId',
    reason: 'Needs the entry id: ContestService.updateEntry scopes the lookup to the caller\'s squad (findEntriesBySquad) before matching entryId. Membership status is unchecked: #291.',
  },
  {
    route: 'GET /api/v1/contests/:contestId/entries/me',
    reason: 'Scoped to the caller\'s own squad in ContestService.getMyEntry; a caller with no squad in the league gets a null entry, never another squad\'s.',
  },
  {
    route: 'GET /api/v1/contests/:contestId/entries/:entryId',
    reason: 'AUTHORIZES NOWHERE: ContestService.getEntryDetail reads membership only to decide pick visibility; any signed-in user can read any entry. Owes requireMemberOfLeague: #291.',
  },
  {
    route: 'GET /api/v1/contests/:contestId/entries',
    reason: 'AUTHORIZES NOWHERE: ContestService.listEntries reads membership only to order and mark the caller\'s entries; any signed-in user can list any contest\'s entries. Owes requireMemberOfLeague: #291.',
  },
  {
    route: 'GET /api/v1/contests/:contestId/golf/leaderboard',
    reason: 'AUTHORIZES NOWHERE: ContestService.getGolfLeaderboard never checks membership; any signed-in user can read any revealed leaderboard. Owes requireMemberOfLeague: #291.',
  },

  // --- Drafts ---
  {
    route: 'POST /api/v1/drafts/:contestId/pick',
    reason: 'Needs the body\'s entryId: the handler requires an ACTIVE squad membership on the squad that owns that entry of this contest (DRAFT_ENTRY_ACCESS_DENIED).',
  },
  {
    route: 'GET /api/v1/drafts/:contestId',
    reason: 'AUTHORIZES NOWHERE: buildDraftStateResponse never checks membership; any signed-in user sees every entry\'s picks. Owes requireMemberOfLeague: #291.',
  },

  // --- Leagues: the league id is in the route path, so these are league-scoped already ---
  {
    route: 'GET /api/v1/leagues/:id',
    reason: 'The handler (sendLeagueContext) requires an ACTIVE league membership or root admin; it shares that check with getLeagueByCode, which has no league id for a hook to read.',
  },
  {
    route: 'GET /api/v1/leagues/code/:leagueCode',
    reason: 'Addressed by code, not id: the handler (sendLeagueContext) resolves the league, then requires an ACTIVE league membership or root admin.',
  },
  {
    route: 'DELETE /api/v1/leagues/:id/members/me',
    reason: 'Self-service: acts only on the caller\'s own membership (LeagueMemberService.removeMember with the session user), which must exist and be ACTIVE.',
  },

  // --- Invitations: possession of the code is the permission ---
  {
    route: 'GET /api/v1/invitations/:inviteCode',
    reason: 'Public by design (auth-guard skips it): holding the invite code is the permission; it previews the league an invite joins.',
  },
  {
    route: 'GET /api/v1/team-invitations/:inviteCode',
    reason: 'Public by design (auth-guard skips it): holding the invite code is the permission; it previews the squad an owner invite joins.',
  },

  // --- Users: UserService takes the actor and enforces self-or-root-admin itself ---
  ...[
    'GET /api/v1/users/:userId',
    'PUT /api/v1/users/:userId/profile',
    'PUT /api/v1/users/:userId/username',
    'PUT /api/v1/users/:userId/preferences',
    'POST /api/v1/users/:userId/password',
    'POST /api/v1/users/:userId/disable',
    'POST /api/v1/users/:userId/enable',
    'POST /api/v1/users/:userId/revoke-sessions',
    'DELETE /api/v1/users/:userId',
  ].map((route) => ({
    route,
    reason: 'Actor in the signature: UserService receives the session actor and requires self or root admin (requireReadableUser / requireWritableUser).',
  })),
  {
    route: 'POST /api/v1/users/:userId/reset-password',
    reason: 'Actor in the signature: UserService.resetPassword requires root admin (requireRootAdmin).',
  },
  {
    route: 'POST /api/v1/users/:userId/root-admin',
    reason: 'Actor in the signature: UserService.setRootAdmin requires root admin (requireRootAdmin).',
  },

  // --- Global objects (docs/DOMAIN-OPERATIONS.md A11): reads are `authenticated` ---
  // The writes beside them are root-admin and declare `onRequest: requireRootAdmin`.
  ...[
    'GET /api/v1/events/:eventId',
    'GET /api/v1/events/:eventId/rounds',
    'GET /api/v1/events/:eventId/participants',
    'GET /api/v1/events/:eventId/tiers',
    'GET /api/v1/sport-leagues/:sportLeagueId',
    'GET /api/v1/sport-leagues/:sportLeagueId/affiliations',
    'GET /api/v1/sport-leagues/:sportLeagueId/seasons',
    'GET /api/v1/seasons/:seasonId',
    'GET /api/v1/participants/:id',
    'GET /api/v1/participants/:id/provider-mappings',
  ].map((route) => ({
    route,
    reason: 'Global object read (access rule A11): owned by no league, identical for every viewer, so readable by any signed-in user.',
  })),
];
