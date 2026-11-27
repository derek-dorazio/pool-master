import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminApiHeaders, expectOk, type AuthHeaders } from './helpers/admin-api';
import { readAdminCredentials, type AdminCredentials } from './helpers/admin-session';
import { submitAndRead } from './helpers/browser-writes';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { createTestEventThroughApi, findSeededSportLeagueThroughApi } from './helpers/test-event';
import { registerFreshUser } from './helpers/user-session';
import { newRunId, e2eName, e2eEmail, e2eUsername, e2eLeagueCode } from './helpers/test-marker';
import { bracketLoadMatch } from './helpers/match-sides';
import { squaresGameIdsThroughApi } from './helpers/squares-games';

/**
 * #2154 — the bowl games journey: the root admin releases a bowls event of NCAA men's football
 * through the API, two bowl games on the league's BOWLS slot, with no seeds, tiers or prices, since
 * no tiered or budget setup covers the bowls (act 1: the setting, not the thing under test); and a
 * new commissioner creates a Pick'em contest on the bowls from the bowls' straight-up preset, then
 * a Squares contest on one bowl game (act 2).
 *
 * The golden journey's shape and safety rules, for the same reasons (its header has them in full):
 * a serial file sharing module state between acts, run-unique names, assertions only about what
 * this run created, and teardown of every attempt in `afterAll`. The bowls are on fixed far-future
 * dates, so nothing depends on the day the suite runs. Not tagged `@smoke`.
 */

/** The two bowls, away team first. */
const BOWLS: ReadonlyArray<{ kickoff: string; away: string; home: string }> = [
  { kickoff: '2099-12-30T20:00:00.000Z', away: 'Hoosiers', home: 'Ducks' },
  { kickoff: '2099-12-31T20:00:00.000Z', away: 'Bulldogs', home: 'Buckeyes' },
];

type BowlJourneyState = {
  run: JourneyRun;
  eventId?: string;
  /** Each bowl's game id, in BOWLS order. */
  gameIds?: string[];
  leagueId?: string;
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

let admin: AdminCredentials | undefined;
let journey: BowlJourneyState | undefined;
const runs: JourneyRun[] = [];

test.afterAll(async ({ playwright }, testInfo) => {
  if (!admin || runs.length === 0) {
    return;
  }
  let api: APIRequestContext | undefined;
  try {
    api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
    for (const run of runs) {
      try {
        await removeJourneyRun(api, admin, run);
      } catch (error) {
        console.error(`[teardown ${run.runId}] aborted, run data may remain:`, error);
      }
    }
  } catch (error) {
    console.error('[teardown] could not start; every attempt of this worker may remain:', error);
  } finally {
    await api?.dispose();
  }
});

function requireJourney(): Required<BowlJourneyState> {
  if (!journey) {
    throw new Error('act 1 did not record this attempt; the later acts have nothing to consume');
  }
  return journey as Required<BowlJourneyState>;
}

function teamName(run: JourneyRun, name: string): string {
  return `${run.playerNamePrefix} ${name}`;
}

async function postJson<T>(api: APIRequestContext, headers: AuthHeaders, path: string, data: unknown, method: 'post' | 'put' | 'patch' = 'post'): Promise<T> {
  const options = data === undefined ? { headers } : { headers, data };
  const response = await expectOk(api[method](path, options), `${method.toUpperCase()} ${path}`);
  return (await response.json()) as T;
}

test('act 1: the root admin releases two bowl games on the BOWLS slot, with no seeds, tiers or prices', async ({ playwright }, testInfo) => {
  test.setTimeout(120_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  const runId = newRunId();
  const run: JourneyRun = {
    runId,
    sport: 'FOOTBALL',
    tourUrlSegment: 'ncaamf',
    playerNamePrefix: e2eName('Bowl Club', runId),
    tournamentName: e2eName('Bowl Games', runId),
    commissioner: {
      username: e2eUsername('bc', runId),
      email: e2eEmail('bc', runId),
      firstName: 'E2E',
      lastName: `Bowl Commissioner ${runId}`,
    },
    member: {
      username: e2eUsername('bm', runId),
      email: e2eEmail('bm', runId),
      firstName: 'E2E',
      lastName: `Bowl Member ${runId}`,
    },
    leagueName: e2eName('Bowl League', runId),
    leagueCode: e2eLeagueCode('B', runId),
    contestName: e2eName('Bowl Pickem', runId),
    squadName: e2eName('Bowlers', runId),
  };
  runs.push(run);
  journey = { run };
  console.log(`[bowl games journey ${runId}] event="${run.tournamentName}" league=${run.leagueCode}`);

  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const headers = await adminApiHeaders(api, credentials);
    if (!headers) {
      throw new Error('the root admin could not sign in to the API');
    }

    // A league is added by migration, so a journey plays in a seeded one, on its own test slots (#2004).
    const sportLeague = await findSeededSportLeagueThroughApi(api, headers, 'FOOTBALL', run.tourUrlSegment);
    const event = await createTestEventThroughApi(api, headers, {
      sportLeagueId: sportLeague.id,
      slotKind: 'TOURNAMENT',
      slotKey: 'BOWLS',
      slotLabel: run.tournamentName,
      name: run.tournamentName,
      startsAt: BOWLS[0].kickoff,
      autoLifecycleEnabled: false,
    });
    journey.eventId = event.id;
    const teams = BOWLS.flatMap((bowl) => [bowl.away, bowl.home]);
    const participantIds: string[] = [];
    for (const name of teams) {
      const { participant } = await postJson<{ participant: { id: string } }>(api, headers, '/api/v1/participants/', {
        isTestData: true,
        sportLeagueId: sportLeague.id,
        participantType: 'TEAM',
        name: teamName(run, name),
      });
      participantIds.push(participant.id);
    }
    await postJson(api, headers, `/api/v1/events/${event.id}/participants`, { participantIds });

    const { participants } = await (await expectOk(api.get(`/api/v1/events/${event.id}/participants`, { headers }), 'read the field')).json() as {
      participants: Array<{ id: string; participant: { name: string } }>;
    };
    const rowOf = (name: string) => {
      const row = participants.find((candidate) => candidate.participant.name === teamName(run, name));
      if (!row) {
        throw new Error(`${name} is not in the field`);
      }
      return row.id;
    };
    const { matches } = await postJson<{ matches: Array<{ id: string; matchNumber: number }> }>(api, headers, `/api/v1/events/${event.id}/bracket`, {
      matches: BOWLS.map((bowl, index) => bracketLoadMatch({
        matchNumber: index + 1, roundNumber: 1, home: rowOf(bowl.home), away: rowOf(bowl.away), isNeutralSite: false, scheduledDate: bowl.kickoff, advancesTo: null,
      })),
    }, 'put');
    // No tiered or budget setup covers the bowls, so release asks for no tiers or prices.
    const released = await postJson<{ event: { status: string } }>(api, headers, `/api/v1/events/${event.id}/release`, undefined);
    expect(released.event.status).toBe('SCHEDULED');
    // The squares picker offers each bowl's Game 1 (#2050).
    const squaresGames = await squaresGameIdsThroughApi(api, headers, event.id);
    journey.gameIds = BOWLS.map((_, index) => {
      const game = matches.find((match) => match.matchNumber === index + 1);
      const gameId = game === undefined ? undefined : squaresGames.get(game.id);
      if (gameId === undefined) throw new Error(`bowl ${index + 1} is not a squares game choice`);
      return gameId;
    });
  } finally {
    await api.dispose();
  }
});

test('act 2: a new commissioner creates a bowls Pick\'em from the straight-up preset, then Squares on one bowl game', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run } = state;
  const [firstBowl] = BOWLS;

  await test.step('a fresh commissioner registers and creates a league', async () => {
    await page.goto('/');
    await page.getByTestId('auth-mode-register').click();
    await registerFreshUser(page, run.commissioner);
    await page.getByTestId('welcome-create-league').click();
    await page.getByTestId('create-league-code').fill(run.leagueCode);
    await page.getByTestId('create-league-name').fill(run.leagueName);
    const created = await submitAndRead<{ league: { id: string } }>(page, 'create-league-submit', 'POST', '/api/v1/leagues');
    state.leagueId = created.league.id;
    await expect(page.getByTestId('league-home')).toBeVisible();
  });

  await test.step('choose American football, the bowls and the Pick\'em format, straight up, and create it', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
    await expect(page.getByTestId('create-contest-page')).toBeVisible();
    await page.getByTestId('contest-sport-FOOTBALL').click();
    const bowls = page.getByTestId(`contest-event-${state.eventId}`);
    await expect(bowls).toContainText(run.tournamentName);
    await bowls.click();
    await expect(bowls).toBeChecked();
    await page.getByTestId('contest-format-PICK_EM').click();
    await expect(page.getByTestId('contest-pick-em-mode-STRAIGHT_UP')).toBeChecked();
    await page.getByTestId('contest-name').fill(run.contestName);
    const created = await submitAndRead<{ contest: { contestFormat: string; selectionType: string } }>(
      page,
      'create-contest-submit',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contests`,
    );
    expect([created.contest.contestFormat, created.contest.selectionType]).toEqual(['PREDICTION', 'PICK_EM']);
    await expect(page.getByTestId('manage-contest-page')).toBeVisible();
  });

  await test.step('choose the bowls, the Squares format and the first bowl game, and create it', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
    await expect(page.getByTestId('create-contest-page')).toBeVisible();
    await page.getByTestId('contest-sport-FOOTBALL').click();
    await page.getByTestId('contest-format-SQUARES').click();
    const bowls = page.getByTestId(`contest-event-${state.eventId}`);
    await bowls.click();
    await expect(bowls).toBeChecked();
    const game = page.getByTestId('contest-squares-game');
    await game.selectOption(state.gameIds[0]);
    await expect(game).toHaveValue(state.gameIds[0]);
    // Not a neutral site, so the away team is at the home team.
    await expect(game).toContainText(`${teamName(run, firstBowl.away)} @ ${teamName(run, firstBowl.home)}`);
    await page.getByTestId('contest-name').fill(e2eName('Bowl Squares', run.runId));
    const created = await submitAndRead<{ contest: { contestFormat: string; selectionType: string } }>(
      page,
      'create-contest-submit',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contests`,
    );
    expect([created.contest.contestFormat, created.contest.selectionType]).toEqual(['SQUARES', 'SQUARES']);
    await expect(page.getByTestId('manage-contest-page')).toBeVisible();
  });
});
