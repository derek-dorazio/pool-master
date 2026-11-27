import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminApiHeaders, expectOk, type AuthHeaders } from './helpers/admin-api';
import { standardPricingRequest } from './helpers/standard-pricing';
import { logOut, readAdminCredentials, type AdminCredentials } from './helpers/admin-session';
import { submitAndRead } from './helpers/browser-writes';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { createTestEventThroughApi, findSeededSportLeagueThroughApi } from './helpers/test-event';
import { registerFreshUser } from './helpers/user-session';
import { newRunId, e2eName, e2eEmail, e2eUsername, e2eLeagueCode } from './helpers/test-marker';
import { AWAY_SIDE, HOME_SIDE, bracketLoadMatch } from './helpers/match-sides';
import { tierSetSlotUrl } from './helpers/tier-set-slot';

/**
 * #721 — the bracket pool journey: the root admin sets up a released four-team basketball
 * tournament of two rounds through the API (act 1: it is the setting, not the thing under test);
 * a new commissioner creates a Bracket contest on it with its round points and opens it (act 2);
 * and a new member joins by link, fills in the whole bracket, changes a first-round pick so the
 * final's pick that depended on it is cleared, picks the final again, saves a tiebreaker and
 * submits (act 3).
 *
 * The golden journey's shape and safety rules, for the same reasons (its header has them in full):
 * a serial file sharing module state between acts, run-unique names, assertions only about what
 * this run created, and teardown of every attempt in `afterAll`. The tournament starts on a fixed
 * far-future date, so nothing depends on the day the suite runs. Not tagged `@smoke`.
 */

/**
 * The field by seed, best first, one team on each of the league's four seed lines (1-4, 5-8, 9-12,
 * 13 and up), so every tier has a team: Duke plays Texas and Houston plays Vermont; the winners
 * meet in the final.
 */
const FIELD: ReadonlyArray<{ name: string; seed: number }> = [
  { name: 'Duke', seed: 1 },
  { name: 'Houston', seed: 8 },
  { name: 'Vermont', seed: 9 },
  { name: 'Texas', seed: 16 },
];
const TOURNAMENT_START = '2099-03-19T16:00:00.000Z';
const ROUND_VALUES = '1, 2';
const TIEBREAKER = 141;


type BracketJourneyState = {
  run: JourneyRun;
  eventId?: string;
  /** Field-row ids by team name. */
  fieldRowIds?: Record<string, string>;
  leagueId?: string;
  contestId?: string;
  joinUrl?: string;
  entryId?: string;
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

let admin: AdminCredentials | undefined;
let journey: BracketJourneyState | undefined;
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

function requireJourney(): Required<BracketJourneyState> {
  if (!journey) {
    throw new Error('act 1 did not record this attempt; the later acts have nothing to consume');
  }
  return journey as Required<BracketJourneyState>;
}

function teamName(run: JourneyRun, name: string): string {
  return `${run.playerNamePrefix} ${name}`;
}

async function postJson<T>(api: APIRequestContext, headers: AuthHeaders, path: string, data: unknown, method: 'post' | 'put' = 'post'): Promise<T> {
  const options = data === undefined ? { headers } : { headers, data };
  const response = await expectOk(api[method](path, options), `${method.toUpperCase()} ${path}`);
  return (await response.json()) as T;
}

test('act 1: the root admin releases a four-team basketball tournament of two rounds with its bracket loaded', async ({ playwright }, testInfo) => {
  test.setTimeout(120_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  const runId = newRunId();
  const run: JourneyRun = {
    runId,
    sport: 'BASKETBALL',
    tourUrlSegment: 'ncaawb',
    playerNamePrefix: e2eName('Team', runId),
    tournamentName: e2eName('Bracket Classic', runId),
    commissioner: {
      username: e2eUsername('bc', runId),
      email: e2eEmail('bc', runId),
      firstName: 'E2E',
      lastName: `Bracket Commissioner ${runId}`,
    },
    member: {
      username: e2eUsername('bm', runId),
      email: e2eEmail('bm', runId),
      firstName: 'E2E',
      lastName: `Bracket Member ${runId}`,
    },
    leagueName: e2eName('Bracket League', runId),
    leagueCode: e2eLeagueCode('B', runId),
    contestName: e2eName('Bracket Pool', runId),
    squadName: e2eName('Bracketeers', runId),
  };
  runs.push(run);
  journey = { run };
  console.log(`[bracket journey ${runId}] tournament="${run.tournamentName}" league=${run.leagueCode}`);

  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const headers = await adminApiHeaders(api, credentials);
    if (!headers) {
      throw new Error('the root admin could not sign in to the API');
    }

    // A league is added by migration, so a journey plays in a seeded one, on its own test slots (#2004).
    const sportLeague = await findSeededSportLeagueThroughApi(api, headers, 'BASKETBALL', run.tourUrlSegment);
    // Four teams start at the semifinals.
    const event = await createTestEventThroughApi(api, headers, {
      sportLeagueId: sportLeague.id,
      slotKind: 'SEMIFINAL',
      slotLabel: run.tournamentName,
      name: run.tournamentName,
      startsAt: TOURNAMENT_START,
      rounds: 2,
      autoLifecycleEnabled: false,
    });
    const eventId = event.id;
    journey.eventId = eventId;

    const participantIds: string[] = [];
    for (const { name } of FIELD) {
      const { participant } = await postJson<{ participant: { id: string } }>(api, headers, '/api/v1/participants/', {
          isTestData: true,
        sportLeagueId: sportLeague.id,
        participantType: 'TEAM',
        name: teamName(run, name),
      });
      participantIds.push(participant.id);
    }
    await postJson(api, headers, `/api/v1/events/${eventId}/participants`, { participantIds });
    // Each team's seed goes in through the grid save, by field row id (the field upload is gone, #2008).
    const added = await (await expectOk(api.get(`/api/v1/events/${eventId}/participants`, { headers }), 'read the added field')).json() as {
      participants: Array<{ id: string; participantId: string }>;
    };
    await expectOk(api.patch(`/api/v1/events/${eventId}/participants`, {
      headers,
      data: {
        participants: FIELD.map((team, index) => ({
          sportEventParticipantId: added.participants.find((row) => row.participantId === participantIds[index])?.id,
          seedNumber: team.seed,
        })),
      },
    }), 'seed the field');
    const slotUrl = await tierSetSlotUrl(api, eventId, headers);
    await postJson(api, headers, `${slotUrl}/tiers/auto-assign`, {});
    await postJson(api, headers, `${slotUrl}/prices/auto-assign`, await standardPricingRequest(api, headers));

    const { participants } = await (await expectOk(api.get(`/api/v1/events/${eventId}/participants`, { headers }), 'read the field')).json() as {
      participants: Array<{ id: string; participant: { name: string } }>;
    };
    const fieldRowIds = Object.fromEntries(FIELD.map(({ name }) => {
      const row = participants.find((candidate) => candidate.participant.name === teamName(run, name));
      if (!row) {
        throw new Error(`${name} is not in the field`);
      }
      return [name, row.id];
    }));
    journey.fieldRowIds = fieldRowIds;

    await postJson(api, headers, `/api/v1/events/${eventId}/bracket`, {
      matches: [
        bracketLoadMatch({ matchNumber: 1, roundNumber: 1, home: fieldRowIds['Duke'], away: fieldRowIds['Texas'], isNeutralSite: true, scheduledDate: null, advancesTo: { roundNumber: 2, matchNumber: 1, sideNumber: HOME_SIDE } }),
        bracketLoadMatch({ matchNumber: 2, roundNumber: 1, home: fieldRowIds['Houston'], away: fieldRowIds['Vermont'], isNeutralSite: true, scheduledDate: null, advancesTo: { roundNumber: 2, matchNumber: 1, sideNumber: AWAY_SIDE } }),
        bracketLoadMatch({ matchNumber: 1, roundNumber: 2, home: null, away: null, isNeutralSite: true, scheduledDate: null, advancesTo: null }),
      ],
    }, 'put');
    const released = await postJson<{ event: { status: string } }>(api, headers, `/api/v1/events/${eventId}/release`, undefined);
    expect(released.event.status).toBe('SCHEDULED');
  } finally {
    await api.dispose();
  }
});

test('act 2: a new commissioner creates a Bracket contest on the tournament with its round points, opens it, and hands out a join link', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run } = state;

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

  await test.step('choose basketball, the tournament and the Bracket format, and give a correct pick 1 then 2 points', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
    await expect(page.getByTestId('create-contest-page')).toBeVisible();
    await page.getByTestId('contest-sport-BASKETBALL').click();
    const tournament = page.getByTestId(`contest-event-${state.eventId}`);
    await expect(tournament).toContainText(run.tournamentName);
    await tournament.click();
    await expect(tournament).toBeChecked();
    // The league's default setup fills the form once its setups arrive; the commissioner waits for
    // it, then picks Bracket, which starts from the league's default bracket setup (#2014).
    const startFrom = page.getByRole('radiogroup', { name: 'Start from' });
    await expect(startFrom.locator('[aria-checked="true"]')).toHaveCount(1);
    await page.getByTestId('contest-format-BRACKET').click();
    await expect(page.getByTestId('contest-format-BRACKET')).toBeChecked();
    await expect(page.getByTestId('contest-bracket-rules')).toBeVisible();
    await expect(startFrom.locator('[aria-checked="true"]')).toHaveCount(1);
    await page.getByTestId('contest-scoring-round-values').fill(ROUND_VALUES);
    await page.getByTestId('contest-name').fill(run.contestName);
  });

  await test.step('create the contest as a prediction contest with the bracket selection type', async () => {
    const created = await submitAndRead<{ contest: { id: string; contestFormat: string; selectionType: string } }>(
      page,
      'create-contest-submit',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contests`,
    );
    expect(created.contest.contestFormat).toBe('PREDICTION');
    expect(created.contest.selectionType).toBe('BRACKET');
    state.contestId = created.contest.id;
    await expect(page.getByTestId('manage-contest-page')).toBeVisible();
    await expect(page.getByTestId('manage-contest-format')).toContainText('Bracket');
  });

  await test.step('open the contest to the league', async () => {
    await page.getByTestId('contest-open-to-league').click();
    const opened = await submitAndRead<{ contest: { status: string } }>(
      page,
      'contest-open-confirm',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contest-management/contests/${state.contestId}/open`,
    );
    expect(opened.contest.status).toBe('OPEN');
  });

  await test.step('generate the join URL', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/invites`);
    const created = await submitAndRead<{ invitation: { inviteCode: string } }>(
      page,
      'league-create-join-url',
      'POST',
      `/api/v1/leagues/${state.leagueId}/invite-link`,
    );
    const joinUrl = page.getByTestId('league-join-url');
    await expect(joinUrl).toHaveValue(new RegExp(`/invite/${created.invitation.inviteCode}$`));
    state.joinUrl = await joinUrl.inputValue();
  });

  await test.step('the commissioner logs out', async () => {
    await logOut(page);
  });
});

test('act 3: a new member joins, fills in the bracket, sees a changed pick clear the final\'s pick, saves a tiebreaker and submits', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run, fieldRowIds } = state;
  const teamButton = (roundNumber: number, matchNumber: number, name: string) => page.getByTestId(`bracket-game-${roundNumber}-${matchNumber}-team-${fieldRowIds[name]}`);
  const gamePicksPath = () => `/api/v1/selections/${state.contestId}/entries/${state.entryId}/events/${state.eventId}/game-picks`;

  /** Picks one team and waits for the saved bracket, which replaces the page's. */
  async function pick(roundNumber: number, matchNumber: number, name: string) {
    await submitAndRead(page, `bracket-game-${roundNumber}-${matchNumber}-team-${fieldRowIds[name]}`, 'PUT', gamePicksPath());
    await expect(teamButton(roundNumber, matchNumber, name)).toHaveAttribute('aria-pressed', 'true');
  }

  await test.step('register through the join link and accept', async () => {
    await page.goto(state.joinUrl);
    await page.getByTestId('invite-create-account').click();
    await registerFreshUser(page, run.member);
    await expect(page.getByTestId('join-league-page')).toBeVisible();
    await page.getByTestId('join-league-team-name').fill(run.squadName);
    await page.getByTestId('join-league-team-icon-CAPTAIN_SMILE_OCEAN').click();
    await page.getByTestId('invite-accept').click();
    await expect(page.getByTestId('league-home')).toBeVisible();
  });

  await test.step('create an entry and land on its empty bracket', async () => {
    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    const created = await submitAndRead<{ entry: { id: string } }>(
      page,
      'contest-board-create-entry',
      'POST',
      `/api/v1/contests/${state.contestId}/entries/me`,
    );
    state.entryId = created.entry.id;
    await expect(page.getByTestId('bracket-board')).toBeVisible();
    await expect(page.getByTestId('bracket-picked-count')).toHaveText('0 of 3');
    await expect(page.getByTestId('bracket-game-2-1-open-home')).toBeVisible();
  });

  await test.step('pick Duke and Houston in the first round, then Duke in the final the two picks fill', async () => {
    await pick(1, 1, 'Duke');
    await pick(1, 2, 'Houston');
    await expect(teamButton(2, 1, 'Duke')).toBeVisible();
    await expect(teamButton(2, 1, 'Houston')).toBeVisible();
    await pick(2, 1, 'Duke');
    await expect(page.getByTestId('bracket-picked-count')).toHaveText('3 of 3');
  });

  await test.step('switch the first game to Texas: the final now offers Texas, and its Duke pick is cleared', async () => {
    await pick(1, 1, 'Texas');
    await expect(teamButton(2, 1, 'Duke')).toHaveCount(0);
    await expect(teamButton(2, 1, 'Texas')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('bracket-picked-count')).toHaveText('2 of 3');
    await pick(2, 1, 'Texas');
  });

  await test.step(`type a tiebreaker of ${TIEBREAKER} total points and submit the bracket, which saves the tiebreaker first`, async () => {
    await expect(page.getByTestId('bracket-submit')).toBeDisabled();
    await page.getByTestId('bracket-tiebreaker-input').fill(String(TIEBREAKER));
    await expect(page.getByTestId('bracket-submit')).toBeEnabled();
    const savedResponse = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === gamePicksPath());
    const submitted = await submitAndRead<{ status: string }>(page, 'bracket-submit', 'POST', `${gamePicksPath()}/submit`);
    expect(submitted.status).toBe('SUBMITTED');
    expect(await (await savedResponse).json()).toMatchObject({ tiebreakerValue: TIEBREAKER });
    // Submitting returns to the contest's page, which lists the entry as the member's, submitted.
    await expect(page.getByTestId(`contest-board-entry-${state.entryId}`)).toHaveAttribute('data-mine', 'true');
    await expect(page.getByTestId(`contest-board-entry-status-${state.entryId}`)).toHaveText('Submitted');
  });

  await test.step('the member logs out', async () => {
    await logOut(page);
  });
});
