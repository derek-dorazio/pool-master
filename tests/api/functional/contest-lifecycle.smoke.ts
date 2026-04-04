import { BASE_URL, smokeFetch, expectStatus } from '../setup';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ContestType, LeagueVisibility, ScoringEngine, SelectionType, Sport } from '@poolmaster/shared/domain';

/**
 * MVP smoke baseline — contest lifecycle over deployed API.
 *
 * This suite creates its own league and contest, then verifies the contest can
 * be listed, fetched, updated, and deleted using real routes and real enums.
 */

let ownerToken: string;
let leagueId: string;
let contestId: string;

async function register(displayName: string) {
  const email = `contest-${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}@mvp.test`;
  const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.register}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'SmokePass123',
      displayName,
    }),
  });
  await expectStatus(res, 201, `register ${displayName}`);
  return res.json() as Promise<{ tokens: { accessToken: string } }>;
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function bodylessAuthHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
  };
}

describe('MVP Contest Lifecycle Smoke', () => {
  it('creates a league and contest using current MVP enums', async () => {
    const owner = await register('Contest Owner');
    ownerToken = owner.tokens.accessToken;

    const leagueRes = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.create}`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        name: 'Smoke Contest League',
        visibility: LeagueVisibility.PRIVATE,
        maxMembers: 12,
      }),
    });
    await expectStatus(leagueRes, 201, 'create league for contest');
    const leagueBody = await leagueRes.json() as { league: { id: string } };
    leagueId = leagueBody.league.id;

    const contestRes = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.contests(leagueId)}`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        name: 'Smoke MVP Contest',
        sport: Sport.GOLF,
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        selectionConfig: {
          rounds: 1,
          tierAssignmentMethod: 'COMMISSIONER',
          tierConfig: [
            {
              tierId: 'tier-1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 1,
              participantIds: [],
            },
          ],
        },
      }),
    });
    await expectStatus(contestRes, 201, 'create contest');
    const contestBody = await contestRes.json() as { contest: { id: string; name: string; selectionType: string } };
    contestId = contestBody.contest.id;
    expect(contestBody.contest.name).toBe('Smoke MVP Contest');
    expect(contestBody.contest.selectionType).toBe(SelectionType.TIERED);
  });

  it('lists, fetches, updates, and deletes the contest through live routes', async () => {
    const listRes = await smokeFetch(`${BASE_URL}${API_ROUTES.leagues.contests(leagueId)}`, {
      headers: bodylessAuthHeaders(ownerToken),
    });
    await expectStatus(listRes, 200, 'list contests for league');
    const listBody = await listRes.json() as { contests: Array<{ id: string }> };
    expect(listBody.contests.some((contest) => contest.id === contestId)).toBe(true);

    const detailRes = await smokeFetch(`${BASE_URL}${API_ROUTES.contests.detail(contestId)}`, {
      headers: bodylessAuthHeaders(ownerToken),
    });
    await expectStatus(detailRes, 200, 'fetch contest detail');
    const detailBody = await detailRes.json() as { contest: { id: string; name: string } };
    expect(detailBody.contest.id).toBe(contestId);
    expect(detailBody.contest.name).toBe('Smoke MVP Contest');

    const updateRes = await smokeFetch(`${BASE_URL}${API_ROUTES.contests.detail(contestId)}`, {
      method: 'PUT',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        name: 'Smoke MVP Contest Updated',
      }),
    });
    await expectStatus(updateRes, 200, 'update contest');
    const updateBody = await updateRes.json() as { contest: { id: string; name: string } };
    expect(updateBody.contest.id).toBe(contestId);
    expect(updateBody.contest.name).toBe('Smoke MVP Contest Updated');

    const deleteRes = await smokeFetch(`${BASE_URL}${API_ROUTES.contests.detail(contestId)}`, {
      method: 'DELETE',
      headers: bodylessAuthHeaders(ownerToken),
    });
    await expectStatus(deleteRes, 200, 'delete contest');

    const afterDeleteRes = await smokeFetch(`${BASE_URL}${API_ROUTES.contests.detail(contestId)}`, {
      headers: bodylessAuthHeaders(ownerToken),
    });
    await expectStatus(afterDeleteRes, 404, 'verify contest deletion');
  });
});
