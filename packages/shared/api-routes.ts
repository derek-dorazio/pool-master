/**
 * Canonical API route paths — single source of truth.
 *
 * Used by:
 *   - Active backend route registration reference
 *   - Integration and contract-focused test suites
 *   - Any remaining app code that still needs a stable manual route constant
 *
 * If you add or change a route, update it HERE. Everything else imports from this file.
 */

// ---------------------------------------------------------------------------
// Full endpoint paths (used by frontend + tests)
// ---------------------------------------------------------------------------

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
    list: '/api/v1/users',
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
    list: '/api/v1/leagues',
    create: '/api/v1/leagues',
    detail: (id: string) => `/api/v1/leagues/${id}`,
    details: (id: string) => `/api/v1/leagues/${id}/details`,
    icon: (id: string) => `/api/v1/leagues/${id}/icon`,
    inactivate: (id: string) => `/api/v1/leagues/${id}/inactivate`,
    activate: (id: string) => `/api/v1/leagues/${id}/activate`,
    byCode: (leagueCode: string) => `/api/v1/leagues/code/${leagueCode}`,
    members: (id: string) => `/api/v1/leagues/${id}/members`,
    leave: (id: string) => `/api/v1/leagues/${id}/members/me`,
    memberRole: (leagueId: string, memberId: string) =>
      `/api/v1/leagues/${leagueId}/members/${memberId}/role`,
    removeMember: (leagueId: string, memberId: string) =>
      `/api/v1/leagues/${leagueId}/members/${memberId}`,
    inviteLink: (id: string) => `/api/v1/leagues/${id}/invite-link`,
    contests: (id: string) => `/api/v1/leagues/${id}/contests`,
    squads: (id: string) => `/api/v1/leagues/${id}/squads`,
    contestManagement: (id: string) =>
      `/api/v1/leagues/${id}/contest-management/contests`,
  },

  squads: {
    list: (leagueId: string) => `/api/v1/leagues/${leagueId}/squads`,
    create: (leagueId: string) => `/api/v1/leagues/${leagueId}/squads`,
    detail: (leagueId: string, squadId: string) =>
      `/api/v1/leagues/${leagueId}/squads/${squadId}`,
    inactivate: (leagueId: string, squadId: string) =>
      `/api/v1/leagues/${leagueId}/squads/${squadId}/inactivate`,
    ownerInvitations: (leagueId: string) =>
      `/api/v1/leagues/${leagueId}/squads/owner-invitations`,
    createOwnerInvitation: (leagueId: string, squadId: string) =>
      `/api/v1/leagues/${leagueId}/squads/${squadId}/owner-invitations`,
    replaceOwner: (leagueId: string, squadId: string, userId: string) =>
      `/api/v1/leagues/${leagueId}/squads/${squadId}/owners/${userId}/replace`,
    revokeOwnerInvitation: (leagueId: string, invitationId: string) =>
      `/api/v1/leagues/${leagueId}/squads/owner-invitations/${invitationId}`,
    addMember: (leagueId: string, squadId: string) =>
      `/api/v1/leagues/${leagueId}/squads/${squadId}/members`,
    removeMember: (leagueId: string, squadId: string, userId: string) =>
      `/api/v1/leagues/${leagueId}/squads/${squadId}/members/${userId}`,
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
    list: '/api/v1/contests',
    detail: (id: string) => `/api/v1/contests/${id}`,
    entries: (id: string) => `/api/v1/contests/${id}/entries`,
    myEntry: (id: string) => `/api/v1/contests/${id}/entries/me`,
    pool: (id: string) => `/api/v1/contests/${id}/pool`,
  },

  contestManagement: {
    templates: (leagueId: string) =>
      `/api/v1/leagues/${leagueId}/contest-management/templates`,
    detail: (leagueId: string, contestId: string) =>
      `/api/v1/leagues/${leagueId}/contest-management/contests/${contestId}`,
    configuration: (leagueId: string, contestId: string) =>
      `/api/v1/leagues/${leagueId}/contest-management/contests/${contestId}/configuration`,
  },

  // Drafts
  drafts: {
    start: (contestId: string) => `/api/v1/drafts/${contestId}/start`,
    state: (draftId: string) => `/api/v1/drafts/${draftId}`,
    pick: (draftId: string) => `/api/v1/drafts/${draftId}/pick`,
  },

  // Admin
  admin: {
    health: '/api/v1/admin/health',
    audit: '/api/v1/admin/audit',
  },

  observability: {
    clientLogs: '/api/v1/client-logs',
  },

  // Health
  health: '/health',
  version: '/api/v1/version',
  rootVersion: '/version',
} as const;
