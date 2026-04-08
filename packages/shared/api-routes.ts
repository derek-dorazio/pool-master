/**
 * Canonical API route paths — single source of truth.
 *
 * Used by:
 *   - Backend route registration (packages/core-api/src/index.ts)
 *   - Frontend API client calls (clients/web, clients/admin)
 *   - Test suites (smoke tests, integration tests, MSW handlers)
 *
 * If you add or change a route, update it HERE. Everything else imports from this file.
 */

// ---------------------------------------------------------------------------
// Route prefixes (used by backend app.register)
// ---------------------------------------------------------------------------

export const API_PREFIXES = {
  AUTH: '/api/v1/auth',
  LEAGUES: '/api/v1/leagues',
  SQUADS_BY_LEAGUE: '/api/v1/leagues/:id/squads',
  INVITATIONS: '/api/v1/invitations',
  CONTESTS_BY_LEAGUE: '/api/v1/leagues/:id/contests',
  CONTEST_MANAGEMENT: '/api/v1/leagues/:id/contest-management/contests',
  CONTESTS: '/api/v1/contests',
  PARTICIPANTS: '/api/v1/participants',
  CONTEST_POOL: '/api/v1/contests/:contestId/pool',
  STANDINGS: '/api/v1/contests/:contestId/standings',
  HISTORY: '/api/v1',
  ACCOUNT: '/api/v1/account',
  ADMIN: '/api/v1/admin',
  CONFIG: '/api/v1/config',
  BILLING: '/api/v1/billing',
  WEBHOOKS: '/api/v1',
  SOCIAL: '/api/v1',
  DRAFTS: '/api/v1/drafts',
  SCORING: '/api/v1',
  NOTIFICATIONS: '/api/v1',
} as const;

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
    profile: '/api/v1/auth/profile',
    profileAvatar: '/api/v1/auth/profile/avatar',
    password: '/api/v1/auth/password',
    callback: '/api/v1/auth/callback',
    linkedAccounts: (provider: string) => `/api/v1/auth/linked-accounts/${provider}`,
  },

  // Leagues
  leagues: {
    list: '/api/v1/leagues',
    create: '/api/v1/leagues',
    detail: (id: string) => `/api/v1/leagues/${id}`,
    members: (id: string) => `/api/v1/leagues/${id}/members`,
    leave: (id: string) => `/api/v1/leagues/${id}/members/me`,
    memberRole: (leagueId: string, memberId: string) =>
      `/api/v1/leagues/${leagueId}/members/${memberId}/role`,
    removeMember: (leagueId: string, memberId: string) =>
      `/api/v1/leagues/${leagueId}/members/${memberId}`,
    inviteLink: (id: string) => `/api/v1/leagues/${id}/invite-link`,
    settings: (id: string) => `/api/v1/leagues/${id}/settings`,
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

  // Billing
  billing: {
    plan: '/api/v1/billing/plan',
    plans: '/api/v1/billing/plans',
    usage: '/api/v1/billing/usage',
    entitlements: '/api/v1/billing/entitlements',
    invoices: '/api/v1/billing/invoices',
    tiers: '/api/v1/billing/tiers',
  },

  // Admin
  admin: {
    users: '/api/v1/admin/users',
    tenants: '/api/v1/admin/tenants',
    health: '/api/v1/admin/health',
    audit: '/api/v1/admin/audit',
  },

  // Config
  config: {
    root: '/api/v1/config',
    sports: '/api/v1/config/sports',
    platform: '/api/v1/config/platform',
  },

  // Notifications
  notifications: {
    list: '/api/v1/notifications',
    preferences: '/api/v1/notifications/preferences',
  },

  // Account / Compliance
  account: {
    consent: '/api/v1/account/consent',
  },

  // Health
  health: '/health',
} as const;

// ---------------------------------------------------------------------------
// Helper: strip /api prefix for frontend api-client (which prepends /api)
// ---------------------------------------------------------------------------

/**
 * Returns the path portion after /api, for use with the frontend api-client
 * which already prepends API_BASE='/api'.
 *
 * Example: clientPath(API_ROUTES.auth.login) => '/v1/auth/login'
 */
export function clientPath(fullPath: string): string {
  if (fullPath.startsWith('/api')) {
    return fullPath.slice(4); // remove '/api'
  }
  return fullPath;
}
