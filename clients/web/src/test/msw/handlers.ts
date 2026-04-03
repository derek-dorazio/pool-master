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
    return HttpResponse.json({ success: true });
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
        { id: 'league-1', name: 'Test League', visibility: 'PRIVATE', memberCount: 5, activeContestCount: 1, role: 'OWNER', createdAt: new Date().toISOString() },
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
      league: {
        id: 'league-1',
        name: 'Test League',
        description: 'A competitive pool league.',
        visibility: 'PRIVATE',
        memberCount: 5,
        activeContestCount: 1,
        role: 'OWNER',
        createdAt: new Date().toISOString(),
        settings: {
          invitePolicy: 'COMMISSIONER_ONLY',
          allowMidSeasonJoin: false,
          requireApproval: false,
          activityFeedEnabled: true,
          weeklyRecapEnabled: false,
          weeklyRecapDay: 'MONDAY',
          timezone: 'America/New_York',
          currency: 'USD',
        },
        invitePolicy: 'COMMISSIONER_ONLY',
      },
    });
  }),

  http.get('/api/v1/leagues/:id/members', () => {
    return HttpResponse.json({
      members: [
        { id: 'm-1', userId: 'u-1', displayName: 'Test User', role: 'OWNER', joinedAt: new Date().toISOString() },
        { id: 'm-2', userId: 'u-2', displayName: 'Jordan Lee', role: 'MANAGER', joinedAt: new Date().toISOString() },
      ],
    });
  }),

  http.get('/api/v1/leagues/:id/contests', () => {
    return HttpResponse.json({ contests: [] });
  }),

  http.post('/api/v1/leagues/:id/invite-link', () => {
    return HttpResponse.json({
      invitation: {
        inviteCode: 'test-code',
      },
    }, { status: 201 });
  }),

  http.put('/api/v1/leagues/:id/settings', () => {
    return HttpResponse.json({
      league: {
        id: 'league-1',
        name: 'Test League',
        description: 'A competitive pool league.',
        visibility: 'PRIVATE',
        memberCount: 5,
        activeContestCount: 1,
        role: 'OWNER',
        createdAt: new Date().toISOString(),
        settings: {
          invitePolicy: 'COMMISSIONER_ONLY',
          allowMidSeasonJoin: false,
          requireApproval: false,
          activityFeedEnabled: true,
          weeklyRecapEnabled: false,
          weeklyRecapDay: 'MONDAY',
          timezone: 'America/New_York',
          currency: 'USD',
        },
        invitePolicy: 'COMMISSIONER_ONLY',
      },
    });
  }),

  http.post('/api/v1/leagues/:id/transfer-ownership', () => {
    const now = new Date().toISOString();
    return HttpResponse.json({
      previousOwner: {
        id: 'm-1',
        leagueId: 'league-1',
        userId: 'u-1',
        role: 'COMMISSIONER',
        permissions: [],
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      newOwner: {
        id: 'm-2',
        leagueId: 'league-1',
        userId: 'u-2',
        role: 'OWNER',
        permissions: [],
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }),

  http.get('/api/v1/leagues/:leagueId/members/:memberId/stats', () => {
    return HttpResponse.json({
      totalContests: 0,
      totalWins: 0,
      winRate: 0,
      totalTop3: 0,
      avgPointsPerContest: 0,
      highestScore: { score: 0, contestName: '' },
      currentStreak: null,
      netWinnings: 0,
      avgPercentileRank: 0,
      sportBreakdown: [],
    });
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

  http.get('/api/v1/drafts/:contestId/available', () => {
    return HttpResponse.json([
      { id: 'p1', name: 'Player One', position: 'QB', team: 'KC', ranking: 1, formRating: 9.0, injuryStatus: 'HEALTHY' },
      { id: 'p2', name: 'Player Two', position: 'WR', team: 'DAL', ranking: 2, formRating: 8.5, injuryStatus: 'HEALTHY' },
    ]);
  }),

  http.get('/api/v1/contests/:id', () => {
    return HttpResponse.json({
      contest: { id: 'contest-1', name: 'Test Contest', status: 'DRAFT', contestType: 'SINGLE_EVENT', selectionType: 'SNAKE_DRAFT', scoringEngine: 'STROKE_PLAY', leagueId: 'league-1' },
      selectionConfig: null,
    });
  }),

  http.get('/api/v1/contests/:id/entries', () => {
    const now = new Date().toISOString();
    return HttpResponse.json({
      contestId: 'contest-1',
      total: 2,
      isJoined: true,
      myEntryId: 'entry-1',
      entries: [
        {
          id: 'entry-1',
          contestId: 'contest-1',
          leagueMembershipId: 'm-1',
          name: 'Test User\'s Entry',
          totalScore: 0,
          rank: null,
          isEliminated: false,
          ownerId: 'u-1',
          ownerDisplayName: 'Test User',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'entry-2',
          contestId: 'contest-1',
          leagueMembershipId: 'm-2',
          name: 'Jordan Lee\'s Entry',
          totalScore: 0,
          rank: null,
          isEliminated: false,
          ownerId: 'u-2',
          ownerDisplayName: 'Jordan Lee',
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
  }),

  http.get('/api/v1/contests/:id/entries/me', () => {
    const now = new Date().toISOString();
    return HttpResponse.json({
      contestId: 'contest-1',
      entry: {
        id: 'entry-1',
        contestId: 'contest-1',
        leagueMembershipId: 'm-1',
        name: 'Test User\'s Entry',
        totalScore: 0,
        rank: null,
        isEliminated: false,
        ownerId: 'u-1',
        ownerDisplayName: 'Test User',
        createdAt: now,
        updatedAt: now,
      },
    });
  }),

  http.post('/api/v1/contests/:id/entries/me', () => {
    const now = new Date().toISOString();
    return HttpResponse.json({
      contestId: 'contest-1',
      entry: {
        id: 'entry-1',
        contestId: 'contest-1',
        leagueMembershipId: 'm-1',
        name: 'Test User\'s Entry',
        totalScore: 0,
        rank: null,
        isEliminated: false,
        ownerId: 'u-1',
        ownerDisplayName: 'Test User',
        createdAt: now,
        updatedAt: now,
      },
    }, { status: 201 });
  }),

  http.delete('/api/v1/contests/:id/entries/me', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/contests/:id/standings', () => {
    const now = new Date().toISOString();
    return HttpResponse.json({
      standings: [
        {
          rank: 1,
          entryId: 'entry-1',
          entryName: 'Eagle Eye',
          ownerDisplayName: 'Sarah K.',
          ownerId: 'user-1',
          totalScore: 298,
          previousRank: 2,
          movement: 'up',
          isEliminated: false,
          lastUpdatedAt: now,
        },
        {
          rank: 2,
          entryId: 'entry-2',
          entryName: 'Birdie Brigade',
          ownerDisplayName: 'Jake M.',
          ownerId: 'user-2',
          totalScore: 285,
          previousRank: 1,
          movement: 'down',
          isEliminated: false,
          lastUpdatedAt: now,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 25,
      contestId: 'contest-1',
    });
  }),

  http.get('/api/v1/scoring/contests/:contestId/entry/:entryId', ({ params }) => {
    return HttpResponse.json({
      entryId: params.entryId,
      contestId: params.contestId,
      totalScore: 298,
      timeline: [
        {
          contestId: params.contestId,
          entryId: params.entryId,
          eventTimestamp: new Date().toISOString(),
          pointsEarned: 12,
          runningTotal: 298,
          participantBreakdowns: [
            {
              participantId: 'participant-1',
              statPoints: 10,
              positionPoints: 2,
              bonusPoints: 0,
              penaltyPoints: 0,
              multipliedTotal: 12,
              dnfAdjustment: 0,
              finalScore: 12,
            },
          ],
        },
      ],
    });
  }),

  http.get('/api/v1/contests/:id/head-to-head', () => {
    return HttpResponse.json({ entries: [] });
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
      billingEnabled: false,
      upgradeLabel: 'Coming Soon',
    });
  }),

  http.get('/api/v1/billing/usage', () => {
    return HttpResponse.json({
      usage: {
        leagues: { resource: 'LEAGUES', current: 0, limit: -1, percentage: 0 },
        contests: { resource: 'CONTESTS', current: 0, limit: -1, percentage: 0 },
        members: { resource: 'MEMBERS', current: 0, limit: -1, percentage: 0 },
      },
    });
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

  http.get('/api/v1/search/discover/leagues', ({ request }) => {
    const url = new URL(request.url);
    const sport = url.searchParams.get('sport');
    const leagues = [
      { id: 'l1', name: 'Masters Pool 2026', description: 'Annual Masters tournament pool', sport: 'GOLF', memberCount: 14, maxMembers: 20, activeContestCount: 1, activityLevel: 'HIGH', joinPolicy: 'OPEN', commissionerName: 'Dave' },
      { id: 'l2', name: 'NFL Survivor League', description: 'Pick one team per week', sport: 'NFL', memberCount: 32, maxMembers: null, activeContestCount: 0, activityLevel: 'MEDIUM', joinPolicy: 'OPEN', commissionerName: 'Mike' },
    ];
    const filtered = sport ? leagues.filter((l) => l.sport === sport) : leagues;
    return HttpResponse.json({ leagues: filtered, total: filtered.length });
  }),

  http.get('/api/v1/search/discover/contests', () => {
    const contests = [
      { id: 'c1', leagueName: 'Masters Pool 2026', contestName: 'The Masters — Pick 6', sport: 'GOLF', eventName: 'The Masters 2026', draftType: 'SNAKE', memberCount: 10, maxMembers: 20, entryFee: null, prizePool: null, draftStart: null, lockTime: null, status: 'OPEN' },
    ];
    return HttpResponse.json({ contests, total: contests.length });
  }),

  http.post('/api/v1/search/discover/leagues/:leagueId/join', ({ params }) => {
    return HttpResponse.json({
      membership: {
        id: 'membership-1',
        leagueId: String(params.leagueId),
        userId: 'u-1',
        role: 'MANAGER',
        permissions: [],
        joinedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }, { status: 201 });
  }),
];

export const dashboardHandlers = [
  http.get('/api/v1/activity', () => {
    return HttpResponse.json({
      items: [
        { id: 'activity-1', type: 'announcement', description: 'League update posted', relativeTime: '5m ago' },
      ],
    });
  }),

  http.get('/api/v1/drafts', () => {
    return HttpResponse.json({
      drafts: [
        { id: 'draft-1', name: 'NFL Draft', leagueName: 'Test League', type: 'Snake', scheduledAt: new Date().toISOString() },
      ],
    });
  }),

  http.get('/api/v1/history/highlights', () => {
    return HttpResponse.json({
      recentWin: 'Weekly Picks',
      personalBest: 124,
      currentStreak: 3,
      seasonRecord: { wins: 10, losses: 4 },
    });
  }),
];

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export const draftHandlers = [
  http.get('/api/v1/drafts/:id', () => {
    return HttpResponse.json({ draft: null });
  }),

  http.get('/api/v1/drafts/:id/available', () => {
    return HttpResponse.json([]);
  }),

  http.post('/api/v1/drafts/:id/pick', () => {
    return HttpResponse.json({ success: true });
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

  http.post('/api/v1/account/consent', () => {
    return HttpResponse.json({ success: true });
  }),

  http.get('/api/v1/account/data-export', () => {
    return HttpResponse.json({
      status: 'none',
      requestedAt: null,
      downloadUrl: null,
      expiresAt: null,
      nextAllowedAt: null,
    });
  }),

  http.post('/api/v1/account/data-export', () => {
    return HttpResponse.json({ success: true });
  }),

  http.get('/api/v1/account/activity-limit', () => {
    return HttpResponse.json({
      activityLimit: {
        enabled: false,
        weeklyContestLimit: 10,
      },
    });
  }),

  http.put('/api/v1/account/activity-limit', async ({ request }) => {
    const body = await request.json() as { enabled: boolean; weeklyContestLimit: number };
    return HttpResponse.json({
      activityLimit: body,
    });
  }),

  http.post('/api/v1/account/delete-account', () => {
    return HttpResponse.json({
      requestId: 'del-1',
      message: 'Deletion scheduled in 14 days. You can cancel before then.',
    }, { status: 202 });
  }),

  http.post('/api/v1/account/delete-account/:id/cancel', () => {
    return HttpResponse.json({ success: true, message: 'Deletion cancelled' });
  }),

  http.get('/api/v1/account/self-exclusion', () => {
    return HttpResponse.json({ exclusion: null });
  }),

  http.post('/api/v1/account/self-exclusion', () => {
    return HttpResponse.json({ exclusionId: 'ex-1' }, { status: 201 });
  }),

  http.get('/api/v1/auth/linked-accounts', () => {
    return HttpResponse.json([
      { provider: 'google', connected: true, email: 'dave@gmail.com' },
      { provider: 'apple', connected: false, email: null },
    ]);
  }),

  http.post('/api/v1/auth/linked-accounts/:provider/connect', () => {
    return HttpResponse.json({ success: true });
  }),

  http.delete('/api/v1/auth/linked-accounts/:provider', () => {
    return HttpResponse.json({ success: true });
  }),
];

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export const socialHandlers = [
  http.get('/api/v1/social/leagues/:leagueId/recap', () => {
    return HttpResponse.json({
      weekLabel: 'Mar 16-22',
      standings: [
        { rank: 1, name: 'Mike T.', initials: 'MT', points: 145, change: 2 },
        { rank: 2, name: 'Sarah K.', initials: 'SK', points: 132, change: 0 },
        { rank: 3, name: 'John D.', initials: 'JD', points: 128, change: -1 },
      ],
      highlights: [
        { icon: 'fire', title: 'Highest Score', detail: 'Mike T. — 45 pts this week' },
        { icon: 'chart', title: 'Biggest Mover', detail: 'Mike T. — up 2 spots' },
      ],
      upcoming: [
        { name: 'NBA Playoff Draft', dateTime: '2026-03-25T19:00:00Z', daysUntil: 2 },
      ],
    });
  }),

  http.get('/api/v1/social/messages/conversations', () => {
    return HttpResponse.json([
      { id: 'conv-1', participantName: 'Mike Thompson', participantInitials: 'MT', participantAvatarUrl: null, lastMessage: 'Hey, want to trade picks?', lastMessageAt: new Date().toISOString(), unreadCount: 1 },
      { id: 'conv-2', participantName: 'Sarah Kim', participantInitials: 'SK', participantAvatarUrl: null, lastMessage: 'Thanks for the tip!', lastMessageAt: new Date().toISOString(), unreadCount: 0 },
    ]);
  }),

  http.get('/api/v1/social/messages/conversations/:conversationId', () => {
    return HttpResponse.json([
      { id: 'dm-1', senderId: 'u-2', senderName: 'Mike Thompson', content: 'Hey, want to trade picks?', createdAt: new Date().toISOString(), isOwn: false, delivered: true, read: true },
      { id: 'dm-2', senderId: 'u-1', senderName: 'You', content: 'What are you looking for?', createdAt: new Date().toISOString(), isOwn: true, delivered: true, read: true },
    ]);
  }),

  http.post('/api/v1/social/messages/conversations/:conversationId', () => {
    return HttpResponse.json({ success: true });
  }),

  http.patch('/api/v1/social/messages/conversations/:conversationId/read', () => {
    return HttpResponse.json({ success: true });
  }),

  // Feed endpoints — generated client uses /api/v1/leagues/{leagueId}/feed
  http.get('/api/v1/leagues/:leagueId/feed', () => {
    return HttpResponse.json({
      items: [
        {
          id: 'p-1', type: 'post', authorId: 'u-2', authorName: 'Mike T.', authorInitials: 'MT', authorAvatarUrl: null,
          content: 'Great game last night!',
          createdAt: new Date().toISOString(), pinned: false, pinnedBy: null,
          reactions: [{ emoji: 'thumbsup', count: 3, reacted: false }],
          replyCount: 4, poll: null,
        },
      ],
      pinned: [
        {
          id: 'p-0', type: 'announcement', authorId: 'u-1', authorName: 'Jane D.', authorInitials: 'JD', authorAvatarUrl: null,
          content: 'Draft is this Saturday at 3pm ET.',
          createdAt: new Date().toISOString(), pinned: true, pinnedBy: 'Jane D.',
          reactions: [], replyCount: 0, poll: null,
        },
      ],
      nextCursor: null,
    });
  }),

  http.post('/api/v1/leagues/:leagueId/feed', () => {
    return HttpResponse.json({ success: true });
  }),

  http.post('/api/v1/leagues/:leagueId/feed/:postId/reactions', () => {
    return HttpResponse.json({ success: true });
  }),

  http.post('/api/v1/leagues/:leagueId/feed/:postId/pin', () => {
    return HttpResponse.json({ success: true });
  }),

  http.delete('/api/v1/leagues/:leagueId/feed/:postId/pin', () => {
    return HttpResponse.json({ success: true });
  }),

  http.delete('/api/v1/leagues/:leagueId/feed/:postId', () => {
    return HttpResponse.json({ success: true });
  }),

  // Replies — GET still uses old /v1/social pattern (not in OpenAPI spec)
  http.get('/api/v1/social/feed/:postId/replies', () => {
    return HttpResponse.json([
      { id: 'r1', authorName: 'John D.', authorInitials: 'JD', content: 'No chance!', createdAt: new Date().toISOString(), reactions: [] },
    ]);
  }),

  http.post('/api/v1/leagues/:leagueId/feed/:postId/replies', () => {
    return HttpResponse.json({ success: true });
  }),

  // Vote — still uses old /v1/social pattern (not in OpenAPI spec)
  http.post('/api/v1/social/feed/:postId/vote', () => {
    return HttpResponse.json({ success: true });
  }),

  http.get('/api/v1/social/shares/:shareId', () => {
    return HttpResponse.json({
      id: 'share-1', type: 'contest_result', title: 'NFL Survivor Pool 2026', sport: 'NFL', sportIcon: 'football',
      winnerName: 'Mike Thompson', winnerAvatarUrl: null, winnerScore: '145 points',
      leaderboard: [
        { rank: 1, name: 'Mike Thompson', score: '145 pts' },
        { rank: 2, name: 'Sarah Kim', score: '132 pts' },
        { rank: 3, name: 'John Doe', score: '128 pts' },
      ],
      dateRange: 'Sep 7 — Jan 12, 2026', imageUrl: null,
      ogTitle: 'Mike won the NFL Survivor Pool!', ogDescription: 'Score: 145 pts — Can you beat it?',
    });
  }),

  http.get('/api/v1/social/contests/:contestId/chat', () => {
    return HttpResponse.json([
      { id: 'c1', type: 'system', authorName: 'System', authorInitials: '', content: 'Draft started', createdAt: new Date().toISOString(), isOwn: false },
      { id: 'c2', type: 'user', authorName: 'Mike', authorInitials: 'MT', content: 'Good luck all!', createdAt: new Date().toISOString(), isOwn: false },
      { id: 'c3', type: 'user', authorName: 'You', authorInitials: 'DO', content: "Let's do it!", createdAt: new Date().toISOString(), isOwn: true },
    ]);
  }),

  http.post('/api/v1/social/contests/:contestId/chat', () => {
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
  ...dashboardHandlers,
  ...billingHandlers,
  ...notificationHandlers,
  ...searchHandlers,
  ...draftHandlers,
  ...configHandlers,
  ...templateHandlers,
  ...invitationHandlers,
  ...accountHandlers,
  ...socialHandlers,
];
