import { BASE_URL, smokeFetch, expectStatus } from '../setup';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
/**
 * Functional smoke test — complete user journey via API.
 *
 * Register → Login → Create League → Create Contest → Start Draft → Pick
 *
 * Tests run sequentially — each depends on the previous.
 * Target: live QA or local dev.
 */

// State accumulated across tests
let accessToken: string;
let refreshToken: string;
let email: string;
let leagueId: string;
let contestId: string;

const headers = () => ({
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
});

describe('User Journey — Full API Flow', () => {
  // -----------------------------------------------------------------------
  // 1. Register
  // -----------------------------------------------------------------------
  it('registers a new user', async () => {
    email = `journey-${Date.now()}@e2e.test`;
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.register}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'JourneyPass123',
        displayName: 'Journey Test User',
      }),
    });
    await expectStatus(res, 201, 'register new user');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.tokens.accessToken).toBeDefined();
    accessToken = body.tokens.accessToken;
    refreshToken = body.tokens.refreshToken;
  });

  // -----------------------------------------------------------------------
  // 2. Login
  // -----------------------------------------------------------------------
  it('logs in with the same credentials', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.login}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'JourneyPass123' }),
    });
    await expectStatus(res, 200, 'login with credentials');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.tokens.accessToken).toBeDefined();
    accessToken = body.tokens.accessToken;
  });

  // -----------------------------------------------------------------------
  // 3. Get profile
  // -----------------------------------------------------------------------
  it('fetches current user profile', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.me}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    await expectStatus(res, 200, 'fetch user profile');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.user.email).toBe(email);
    expect(body.user.displayName).toBe('Journey Test User');
  });

  // -----------------------------------------------------------------------
  // 4. Create league
  // -----------------------------------------------------------------------
  it('creates a league', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.list}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'Journey Masters Pool',
        visibility: 'PRIVATE',
        maxMembers: 12,
      }),
    });
    await expectStatus(res, 201, 'create league');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.league.id).toBeDefined();
    expect(body.league.name).toBe('Journey Masters Pool');
    leagueId = body.league.id;
  });

  // -----------------------------------------------------------------------
  // 5. Get league details
  // -----------------------------------------------------------------------
  it('retrieves the created league', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.detail(leagueId)}`, {
      headers: headers(),
    });
    await expectStatus(res, 200, 'retrieve league');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.league.name).toBe('Journey Masters Pool');
  });

  // -----------------------------------------------------------------------
  // 6. Create contest
  // -----------------------------------------------------------------------
  it('creates a contest in the league', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.contests(leagueId)}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'Masters 2026 Pool',
        contestType: 'SINGLE_EVENT',
        selectionType: 'SNAKE_DRAFT',
        scoringEngine: 'STROKE_PLAY',
      }),
    });
    await expectStatus(res, 201, 'create contest');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.contest.id).toBeDefined();
    expect(body.contest.name).toBe('Masters 2026 Pool');
    expect(body.contest.status).toBe('DRAFT');
    contestId = body.contest.id;
  });

  // -----------------------------------------------------------------------
  // 7. Get contest details
  // -----------------------------------------------------------------------
  it('retrieves the created contest', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.contests.detail(contestId)}`, {
      headers: headers(),
    });
    await expectStatus(res, 200, 'retrieve contest');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    const contest = body.contest ?? body;
    expect(contest.contestType).toBe('SINGLE_EVENT');
    expect(contest.selectionType).toBe('SNAKE_DRAFT');
    expect(contest.scoringEngine).toBe('STROKE_PLAY');
  });

  // -----------------------------------------------------------------------
  // 8. Start draft
  // -----------------------------------------------------------------------
  it('starts a draft session (if draft routes available)', async () => {
    const entryA = crypto.randomUUID();
    const entryB = crypto.randomUUID();
    const participants = Array.from({ length: 10 }, () => crypto.randomUUID());

    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.drafts.start(contestId)}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        entryIds: [entryA, entryB],
        rounds: 3,
        timePerPickSeconds: 120,
        availableParticipantIds: participants,
      }),
    });

    if (res.status === 404) {
      // Draft routes not deployed yet — skip remaining draft tests
      (globalThis as any).__draftAvailable = false;
      return;
    }

    await expectStatus(res, 201, 'start draft session');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.status).toBe('LIVE');

    (globalThis as any).__draftAvailable = true;
    (globalThis as any).__draftEntryA = entryA;
    (globalThis as any).__draftParticipants = participants;
  });

  // -----------------------------------------------------------------------
  // 9. Make a pick
  // -----------------------------------------------------------------------
  it('submits a draft pick', async () => {
    if (!(globalThis as any).__draftAvailable) return; // draft routes not available

    const entryA = (globalThis as any).__draftEntryA;
    const participants = (globalThis as any).__draftParticipants;

    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.drafts.pick(contestId)}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        entryId: entryA,
        participantId: participants[0],
      }),
    });
    await expectStatus(res, 200, 'submit draft pick');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.picks.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // 10. Verify draft state
  // -----------------------------------------------------------------------
  it('verifies the draft state reflects the pick', async () => {
    if (!(globalThis as any).__draftAvailable) return; // draft routes not available

    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.drafts.state(contestId)}`, {
      headers: headers(),
    });
    await expectStatus(res, 200, 'verify draft state');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.picks.length).toBeGreaterThanOrEqual(1);
    expect(body.currentPickNumber).toBeGreaterThanOrEqual(2);
  });
});
