/**
 * #745 — the response schemas no test yet checks against a live response. Read by
 * `scripts/check-contract-verification.mjs`; the rule and its reasoning are in that file's header.
 *
 * Every entry is an endpoint that shipped before the check existed. The list only shrinks: add a
 * contract-verification case (or `expectMatchesSchema` in a journey that already holds the
 * response) and delete the entry. The scanner fails if a listed schema is checked now, or if an
 * entry names no exported schema, so the list cannot drift from the tests.
 *
 * A new endpoint never goes on this list; `rules/testing-rules.md` §4 *Contract Verification
 * Gate* says its contract case lands with it.
 */
export const CONTRACT_VERIFICATION_GAPS = [
  // --- Leagues and invitations ---
  { schema: 'InvitationPreviewResponseSchema', endpoints: 'GET /api/v1/invitations/:inviteCode' },
  { schema: 'LeagueBulkOperationResponseSchema', endpoints: 'POST /api/v1/leagues/:id/members/import' },
  { schema: 'LeagueMembersResponseSchema', endpoints: 'GET /api/v1/leagues/:id/members' },

  // --- Squad owners ---
  { schema: 'SquadMembershipResponseSchema', endpoints: 'POST and DELETE /api/v1/leagues/:id/squads/:squadId/members' },
  { schema: 'TeamOwnerInvitationListResponseSchema', endpoints: 'GET /api/v1/leagues/:id/squads/owner-invitations' },
  { schema: 'TeamOwnerInvitationPreviewResponseSchema', endpoints: 'GET /api/v1/team-invitations/:inviteCode' },
  { schema: 'TeamOwnerInvitationResponseSchema', endpoints: 'the squad owner invitation create, accept, replace and revoke routes' },

  // --- Contests ---
  { schema: 'ContestEntryDeletionResponseSchema', endpoints: 'DELETE /api/v1/contests/:contestId/entries/me' },

  // --- Users ---
  { schema: 'RevokeUserSessionsResponseSchema', endpoints: 'POST /api/v1/users/:userId/revoke-sessions' },

  // --- Events, participants and sport leagues (root admin) ---
  { schema: 'GolfRoundScorePreviewResponseSchema', endpoints: 'POST /api/v1/events/:eventId/rounds/:roundNumber/golf-scores/preview' },
  { schema: 'SeedSportEventParticipantsResponseSchema', endpoints: 'POST /api/v1/events/:eventId/participants/seed' },
  { schema: 'ParticipantProviderMappingListResponseSchema', endpoints: 'GET /api/v1/participants/:id/provider-mappings' },
  { schema: 'ParticipantLeagueAffiliationListResponseSchema', endpoints: 'GET, PATCH and the upload apply of /api/v1/sport-leagues/:sportLeagueId/affiliations' },
  { schema: 'ParticipantLeagueAffiliationResponseSchema', endpoints: 'POST /api/v1/sport-leagues/:sportLeagueId/affiliations' },
  { schema: 'ParticipantLeagueAffiliationUploadPreviewResponseSchema', endpoints: 'POST /api/v1/sport-leagues/:sportLeagueId/affiliations/upload/preview' },
];
