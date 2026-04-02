/**
 * MSW request handlers — default happy-path responses for all API endpoints.
 *
 * These handlers intercept real fetch calls during tests. If a test needs
 * a different response (e.g., error case), use server.use() to override
 * for that specific test.
 *
 * onUnhandledRequest: 'error' is set in server.ts so any fetch to an
 * unhandled URL will immediately fail the test — catching path mismatches.
 */
import { http, HttpResponse } from 'msw';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const authHandlers = [
  http.post('/api/v1/auth/register', () => {
    return HttpResponse.json({
      user: { id: 'u-1', email: 'test@example.com', displayName: 'Test User', createdAt: new Date().toISOString() },
      tokens: { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', expiresIn: 900 },
    }, { status: 201 });
  }),

  http.post('/api/v1/auth/login', () => {
    return HttpResponse.json({
      user: { id: 'u-1', email: 'test@example.com', displayName: 'Test User', createdAt: new Date().toISOString() },
      tokens: { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', expiresIn: 900 },
    });
  }),

  http.post('/api/v1/auth/refresh', () => {
    return HttpResponse.json({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 900,
    });
  }),

  http.post('/api/v1/auth/logout', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/auth/me', () => {
    return HttpResponse.json({
      user: { id: 'u-1', email: 'test@example.com', displayName: 'Test User', createdAt: new Date().toISOString() },
    });
  }),

  http.put('/api/v1/auth/profile', () => {
    return HttpResponse.json({ success: true });
  }),

  http.put('/api/v1/auth/password', () => {
    return HttpResponse.json({ success: true });
  }),

  http.post('/api/v1/auth/callback', () => {
    return HttpResponse.json({
      user: { id: 'u-1', email: 'test@example.com', displayName: 'Test User' },
      tokens: { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', expiresIn: 900 },
    });
  }),
];

// ---------------------------------------------------------------------------
// Leagues
// ---------------------------------------------------------------------------

export const leagueHandlers = [
  http.get('/api/v1/leagues', () => {
    return HttpResponse.json({
      leagues: [
        { id: 'league-1', name: 'Test League', visibility: 'PRIVATE', memberCount: 5, activeContestCount: 1, role: 'Commissioner', createdAt: new Date().toISOString() },
      ],
    });
  }),

  http.post('/api/v1/leagues', () => {
    return HttpResponse.json({
      league: { id: 'league-new', name: 'New League', visibility: 'PRIVATE', memberCount: 1, activeContestCount: 0, createdAt: new Date().toISOString() },
    }, { status: 201 });
  }),

  http.get('/api/v1/leagues/:id', () => {
    return HttpResponse.json({
      league: { id: 'league-1', name: 'Test League', visibility: 'PRIVATE', memberCount: 5, activeContestCount: 1, createdAt: new Date().toISOString() },
    });
  }),

  http.get('/api/v1/leagues/:id/members', () => {
    return HttpResponse.json({
      members: [
        { id: 'm-1', userId: 'u-1', displayName: 'Test User', role: 'OWNER', joinedAt: new Date().toISOString() },
      ],
    });
  }),

  http.get('/api/v1/leagues/:id/contests', () => {
    return HttpResponse.json({ contests: [] });
  }),

  http.post('/api/v1/leagues/:id/invite-link', () => {
    return HttpResponse.json({ invitation: { inviteCode: 'test-code', expiresAt: new Date().toISOString() } });
  }),
];

// ---------------------------------------------------------------------------
// Contests
// ---------------------------------------------------------------------------

export const contestHandlers = [
  http.get('/api/v1/contests', () => {
    return HttpResponse.json({ contests: [] });
  }),

  http.post('/api/v1/leagues/:id/contests', () => {
    return HttpResponse.json({
      contest: { id: 'contest-1', name: 'Test Contest', status: 'DRAFT', contestType: 'SINGLE_EVENT', selectionType: 'SNAKE_DRAFT', scoringEngine: 'STROKE_PLAY', leagueId: 'league-1' },
    }, { status: 201 });
  }),

  http.get('/api/v1/contests/:id', () => {
    return HttpResponse.json({
      contest: { id: 'contest-1', name: 'Test Contest', status: 'DRAFT', contestType: 'SINGLE_EVENT', selectionType: 'SNAKE_DRAFT', scoringEngine: 'STROKE_PLAY', leagueId: 'league-1' },
    });
  }),

  http.get('/api/v1/contests/:id/standings', () => {
    return HttpResponse.json({ standings: [], total: 0, contestId: 'contest-1' });
  }),
];

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const billingHandlers = [
  http.get('/api/v1/billing/plan', () => {
    return HttpResponse.json({
      slug: 'free', name: 'Free', entitlements: { max_leagues: 50, max_members_per_league: 100, max_contests_per_season: 100 },
    });
  }),

  http.get('/api/v1/billing/plans', () => {
    return HttpResponse.json({
      plans: [{ slug: 'free', name: 'Free', monthlyPriceCents: 0, entitlements: {} }],
    });
  }),

  http.get('/api/v1/billing/usage', () => {
    return HttpResponse.json({ usage: [] });
  }),

  http.get('/api/v1/billing/entitlements', () => {
    return HttpResponse.json({ entitlements: { max_leagues: 50 } });
  }),

  http.get('/api/v1/billing/invoices', () => {
    return HttpResponse.json({ invoices: [] });
  }),
];

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationHandlers = [
  http.get('/api/v1/notifications', () => {
    return HttpResponse.json({ items: [], nextCursor: null });
  }),

  http.get('/api/v1/notifications/preferences', () => {
    return HttpResponse.json({
      email: { enabled: true, categories: {} },
      push: { enabled: false, categories: {} },
      inApp: { enabled: true, categories: {} },
    });
  }),

  http.get('/api/v1/notifications/unread-count', () => {
    return HttpResponse.json({ total: 0, grouped: {} });
  }),
];

// ---------------------------------------------------------------------------
// Search & Discovery
// ---------------------------------------------------------------------------

export const searchHandlers = [
  http.get('/api/v1/search/participants', () => {
    return HttpResponse.json({ participants: [], total: 0, facets: {} });
  }),

  http.get('/api/v1/search/leagues', () => {
    return HttpResponse.json({ leagues: [], total: 0 });
  }),

  http.get('/api/v1/search/contests', () => {
    return HttpResponse.json({ contests: [], total: 0 });
  }),
];

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export const draftHandlers = [
  http.get('/api/v1/drafts/:id', () => {
    return HttpResponse.json({ draft: null });
  }),
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const configHandlers = [
  http.get('/api/v1/config', () => {
    return HttpResponse.json({ sports: [], features: {} });
  }),

  http.get('/api/v1/config/sports', () => {
    return HttpResponse.json({ sports: [] });
  }),
];

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const templateHandlers = [
  http.get('/api/v1/templates/scoring', () => {
    return HttpResponse.json({ templates: {} });
  }),
];

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export const invitationHandlers = [
  http.post('/api/v1/invitations/accept', () => {
    return HttpResponse.json({ success: true });
  }),
];

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export const accountHandlers = [
  http.get('/api/v1/account/consent', () => {
    return HttpResponse.json({ consents: [] });
  }),

  http.put('/api/v1/account/consent', () => {
    return HttpResponse.json({ success: true });
  }),
];

// ---------------------------------------------------------------------------
// Combined handlers
// ---------------------------------------------------------------------------

export const handlers = [
  ...authHandlers,
  ...leagueHandlers,
  ...contestHandlers,
  ...billingHandlers,
  ...notificationHandlers,
  ...searchHandlers,
  ...draftHandlers,
  ...configHandlers,
  ...templateHandlers,
  ...invitationHandlers,
  ...accountHandlers,
];
