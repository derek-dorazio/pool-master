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
    me: '/api/v1/auth/me',
  },

  // Leagues
  leagues: {
    list: '/api/v1/leagues',
    create: '/api/v1/leagues',
    detail: (id: string) => `/api/v1/leagues/${id}`,
    inactivate: (id: string) => `/api/v1/leagues/${id}/inactivate`,
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

  // Contests
  contests: {
    list: '/api/v1/contests',
    detail: (id: string) => `/api/v1/contests/${id}`,
    entries: (id: string) => `/api/v1/contests/${id}/entries`,
    myEntry: (id: string) => `/api/v1/contests/${id}/entries/me`,
    standings: (id: string) => `/api/v1/contests/${id}/standings`,
    pool: (id: string) => `/api/v1/contests/${id}/pool`,
  },

  contestManagement: {
    detail: (leagueId: string, contestId: string) =>
      `/api/v1/leagues/${leagueId}/contest-management/contests/${contestId}`,
    configuration: (leagueId: string, contestId: string) =>
      `/api/v1/leagues/${leagueId}/contest-management/contests/${contestId}/configuration`,
  },

  scoring: {
    leaderboard: (contestId: string) => `/api/v1/scoring/contests/${contestId}/leaderboard`,
    entry: (contestId: string, entryId: string) => `/api/v1/scoring/contests/${contestId}/entry/${entryId}`,
    participant: (contestId: string, participantId: string) => `/api/v1/scoring/contests/${contestId}/participant/${participantId}`,
    rollup: (contestId: string) => `/api/v1/scoring/contests/${contestId}/rollup`,
    health: '/api/v1/scoring/health',
  },

  // Drafts
  drafts: {
    start: (contestId: string) => `/api/v1/drafts/${contestId}/start`,
    state: (draftId: string) => `/api/v1/drafts/${draftId}`,
    pick: (draftId: string) => `/api/v1/drafts/${draftId}/pick`,
  },

  // Admin
  admin: {
    users: '/api/v1/admin/users',
    health: '/api/v1/admin/health',
    audit: '/api/v1/admin/audit',
  },

  // Config
  config: {
    pollIntervals: '/api/v1/config/poll-intervals',
  },

  // Notifications
  notifications: {
    list: '/api/v1/notifications',
  },

  // Account / Compliance
  account: {
    consent: '/api/v1/account/consent',
    reactivate: '/api/v1/account/reactivate',
    inactivate: '/api/v1/account/inactivate',
    profile: '/api/v1/account/profile',
    preferences: '/api/v1/account/preferences',
    password: '/api/v1/account/password',
    detail: '/api/v1/account',
  },

  // Health
  health: '/health',
} as const;
