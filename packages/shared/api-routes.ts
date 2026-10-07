/**
 * Canonical API route paths.
 *
 * **Generated from `packages/shared/generated/openapi.json` — do not edit by hand.**
 * Run `npm run api:refresh` to regenerate; `npm run api:check` fails in CI when this file and
 * the spec disagree. The mapping from each name to its operation lives in
 * `scripts/generate-api-routes.mjs`.
 *
 * **Do not add routes here.** Use the generated SDK — `@poolmaster/shared/generated/hey-api` —
 * which has a typed function for every operation in the spec. A literal path is the exception,
 * and it needs the repo owner's explicit approval before it is added. Adding one costs the thing
 * this file was regenerated to buy: the SDK cannot be called with a URL that does not exist,
 * while a path string can be, and this table's previous hand-written version drifted into ten
 * wrong paths and four routes that no longer existed.
 *
 * There are exactly two reasons an entry belongs here, and both are about not being able to use
 * the SDK rather than not wanting to:
 *
 *   1. `clients/poolmaster/src/lib/logger/network-sink.ts` — the log transport needs `fetch` with
 *      `keepalive` and a `sendBeacon` fallback on tab-hide, which the SDK client does not do.
 *   2. Integration suites building `inject()` URLs, which do not go over HTTP at all. These are
 *      migrating to the SDK as the functional suites already have; new suites should start there.
 *
 * A route that is merely convenient to reference is not a third reason. Entries are added to the
 * manifest in `scripts/generate-api-routes.mjs`, not to this file — a hand edit here is reverted
 * by the next `npm run api:refresh` and fails `npm run api:check` in CI before that.
 */

export const API_ROUTES = {
  // Auth
  auth: {
    login: '/api/v1/auth/login',
    register: '/api/v1/auth/register',
    refresh: '/api/v1/auth/refresh',
    logout: '/api/v1/auth/logout',
  },

  // Users — #202 step 3.4. One operation set. `me` resolves to the authenticated caller, so
  // these paths serve both a user acting on themselves and a root admin acting on somebody;
  // access rule A6 decides which is allowed. They replaced `/api/v1/auth/me`,
  // `/api/v1/account/*` and `/api/v1/admin/users/*`.
  users: {
    list: '/api/v1/users/',
    detail: (userId: string) => `/api/v1/users/${userId}`,
    profile: (userId: string) => `/api/v1/users/${userId}/profile`,
    username: (userId: string) => `/api/v1/users/${userId}/username`,
    preferences: (userId: string) => `/api/v1/users/${userId}/preferences`,
    password: (userId: string) => `/api/v1/users/${userId}/password`,
    resetPassword: (userId: string) => `/api/v1/users/${userId}/reset-password`,
    disable: (userId: string) => `/api/v1/users/${userId}/disable`,
    enable: (userId: string) => `/api/v1/users/${userId}/enable`,
    revokeSessions: (userId: string) => `/api/v1/users/${userId}/revoke-sessions`,
    rootAdmin: (userId: string) => `/api/v1/users/${userId}/root-admin`,
  },

  // Leagues
  leagues: {
    list: '/api/v1/leagues/',
    create: '/api/v1/leagues/',
    detail: (id: string) => `/api/v1/leagues/${id}`,
    details: (id: string) => `/api/v1/leagues/${id}/details`,
    icon: (id: string) => `/api/v1/leagues/${id}/icon`,
    inactivate: (id: string) => `/api/v1/leagues/${id}/inactivate`,
    activate: (id: string) => `/api/v1/leagues/${id}/activate`,
    byCode: (leagueCode: string) => `/api/v1/leagues/code/${leagueCode}`,
    members: (id: string) => `/api/v1/leagues/${id}/members`,
    leave: (id: string) => `/api/v1/leagues/${id}/members/me`,
    memberRole: (id: string, uid: string) => `/api/v1/leagues/${id}/members/${uid}/role`,
    removeMember: (id: string, uid: string) => `/api/v1/leagues/${id}/members/${uid}`,
    inviteLink: (id: string) => `/api/v1/leagues/${id}/invite-link`,
    contests: (id: string) => `/api/v1/leagues/${id}/contests/`,
    squads: (id: string) => `/api/v1/leagues/${id}/squads/`,
  },

  squads: {
    list: (id: string) => `/api/v1/leagues/${id}/squads/`,
    create: (id: string) => `/api/v1/leagues/${id}/squads/`,
    detail: (id: string, squadId: string) => `/api/v1/leagues/${id}/squads/${squadId}`,
    inactivate: (id: string, squadId: string) =>
      `/api/v1/leagues/${id}/squads/${squadId}/inactivate`,
    ownerInvitations: (id: string) => `/api/v1/leagues/${id}/squads/owner-invitations`,
    createOwnerInvitation: (id: string, squadId: string) =>
      `/api/v1/leagues/${id}/squads/${squadId}/owner-invitations`,
    replaceOwner: (id: string, squadId: string, userId: string) =>
      `/api/v1/leagues/${id}/squads/${squadId}/owners/${userId}/replace`,
    revokeOwnerInvitation: (id: string, invitationId: string) =>
      `/api/v1/leagues/${id}/squads/owner-invitations/${invitationId}`,
    addMember: (id: string, squadId: string) => `/api/v1/leagues/${id}/squads/${squadId}/members`,
    removeMember: (id: string, squadId: string, userId: string) =>
      `/api/v1/leagues/${id}/squads/${squadId}/members/${userId}`,
  },

  // Invitations
  invitations: {
    preview: (inviteCode: string) => `/api/v1/invitations/${inviteCode}`,
    accept: '/api/v1/invitations/accept',
  },

  teamInvitations: {
    preview: (inviteCode: string) => `/api/v1/team-invitations/${inviteCode}`,
    accept: '/api/v1/team-invitations/accept',
  },

  // Contests
  contests: {
    detail: (contestId: string) => `/api/v1/contests/${contestId}`,
    entries: (contestId: string) => `/api/v1/contests/${contestId}/entries`,
    myEntry: (contestId: string) => `/api/v1/contests/${contestId}/entries/me`,
  },

  contestManagement: {
    detail: (id: string, contestId: string) =>
      `/api/v1/leagues/${id}/contest-management/contests/${contestId}`,
    configuration: (id: string, contestId: string) =>
      `/api/v1/leagues/${id}/contest-management/contests/${contestId}/configuration`,
  },

  // Drafts
  drafts: {
    state: (contestId: string) => `/api/v1/drafts/${contestId}`,
    pick: (contestId: string) => `/api/v1/drafts/${contestId}/pick`,
  },

  observability: {
    clientLogs: '/api/v1/client-logs/',
  },

  health: '/health',
  version: '/api/v1/version/',
  rootVersion: '/version/',
} as const;
