import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminApiHeaders, expectOk, type AuthHeaders } from './helpers/admin-api';
import { logOut, readAdminCredentials, type AdminCredentials } from './helpers/admin-session';
import { submitAndRead } from './helpers/browser-writes';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { registerFreshUser } from './helpers/user-session';

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

/** The field by seed, best first: Duke plays Texas and Houston plays Vermont; the winners meet in the final. */
const FIELD: ReadonlyArray<{ name: string; seed: number }> = [
  { name: 'Duke', seed: 1 },
  { name: 'Houston', seed: 2 },
  { name: 'Vermont', seed: 15 },
  { name: 'Texas', seed: 16 },
];
const TOURNAMENT_START = '2099-03-19T16:00:00.000Z';
const ROUND_VALUES = '1, 2';
const TIEBREAKER = 141;

/** The app's default "Standard" pricing profile, as an event stores it once priced. */
const STANDARD_PRICING = {
  profileName: 'Standard',
  salaryCap: 50_000,
  unit: 100,
  topSharePercent: 24,
  floorSharePercent: 12,
  steepness: 4,
};

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

  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const run: JourneyRun = {
    runId,
    sport: 'BASKETBALL',
    tourName: `E2E Conference ${runId}`,
    playerNamePrefix: `E2E Team ${runId}`,
    tournamentName: `E2E Bracket Classic ${runId}`,
    commissioner: {
      username: `e2e-bc-${runId}`,
      email: `e2e-bc-${runId}@e2e.invalid`,
      firstName: 'E2E',
      lastName: `Bracket Commissioner ${runId}`,
    },
    member: {
      username: `e2e-bm-${runId}`,
      email: `e2e-bm-${runId}@e2e.invalid`,
      firstName: 'E2E',
      lastName: `Bracket Member ${runId}`,
    },
    leagueName: `E2E Bracket League ${runId}`,
    leagueCode: `E2EB${runId.toUpperCase()}`,
    contestName: `E2E Bracket Pool ${runId}`,
    squadName: `E2E Bracketeers ${runId}`,
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

    const { sports } = await (await expectOk(api.get('/api/v1/sports/', { headers }), 'list sports')).json() as {
      sports: Array<{ id: string; sport: string }>;
    };
    const sportId = sports.find((row) => row.sport === 'BASKETBALL')?.id;
    if (!sportId) {
      throw new Error('basketball is not in the sports table');
    }

    const { sportLeague } = await postJson<{ sportLeague: { id: string } }>(api, headers, '/api/v1/sport-leagues/', {
      sport: 'BASKETBALL',
      name: run.tourName,
    });
    const { event } = await postJson<{ event: { id: string } }>(api, headers, '/api/v1/events/', {
      sportLeagueId: sportLeague.id,
      eventYear: 2099,
      name: run.tournamentName,
      startDate: TOURNAMENT_START,
      rounds: 2,
      autoLifecycleEnabled: false,
    });
    const eventId = event.id;
    journey.eventId = eventId;

    const participantIds: string[] = [];
    for (const { name } of FIELD) {
      const { participant } = await postJson<{ participant: { id: string } }>(api, headers, '/api/v1/participants/', {
        sportId,
        participantType: 'TEAM',
        name: teamName(run, name),
      });
      participantIds.push(participant.id);
    }
    await postJson(api, headers, `/api/v1/events/${eventId}/participants`, { participantIds });
    await postJson(api, headers, `/api/v1/events/${eventId}/participants/upload`, {
      rows: FIELD.map((team, index) => ({ playerName: teamName(run, team.name), seedNumber: team.seed, oddsToWin: 2 + index * 5 })),
    });
    await postJson(api, headers, `/api/v1/events/${eventId}/tiers/auto-assign`, { source: 'ODDS', tierSize: 1 });
    await postJson(api, headers, `/api/v1/events/${eventId}/prices/auto-assign`, STANDARD_PRICING);

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
        { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: fieldRowIds['Duke'], awaySportEventParticipantId: fieldRowIds['Texas'], isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 3, side: 'HOME' } },
        { matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: fieldRowIds['Houston'], awaySportEventParticipantId: fieldRowIds['Vermont'], isNeutralSite: true, scheduledDate: null, advancesTo: { matchNumber: 3, side: 'AWAY' } },
        { matchNumber: 3, roundNumber: 2, homeSportEventParticipantId: null, awaySportEventParticipantId: null, isNeutralSite: true, scheduledDate: null, advancesTo: null },
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
    await page.getByTestId('create-league-next').click();
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
    await page.getByTestId('contest-format-BRACKET').click();
    await expect(page.getByTestId('contest-bracket-rules')).toBeVisible();
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
  const teamButton = (matchNumber: number, name: string) => page.getByTestId(`bracket-game-${matchNumber}-team-${fieldRowIds[name]}`);
  const gamePicksPath = () => `/api/v1/selections/${state.contestId}/entries/${state.entryId}/events/${state.eventId}/game-picks`;

  /** Picks one team and waits for the saved bracket, which replaces the page's. */
  async function pick(matchNumber: number, name: string) {
    await submitAndRead(page, `bracket-game-${matchNumber}-team-${fieldRowIds[name]}`, 'PUT', gamePicksPath());
    await expect(teamButton(matchNumber, name)).toHaveAttribute('aria-pressed', 'true');
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
    await expect(page.getByTestId('bracket-progress')).toHaveText('0 of 3 picked');
    await expect(page.getByTestId('bracket-game-3-open-home')).toBeVisible();
  });

  await test.step('pick Duke and Houston in the first round, then Duke in the final the two picks fill', async () => {
    await pick(1, 'Duke');
    await pick(2, 'Houston');
    await expect(teamButton(3, 'Duke')).toBeVisible();
    await expect(teamButton(3, 'Houston')).toBeVisible();
    await pick(3, 'Duke');
    await expect(page.getByTestId('bracket-progress')).toHaveText('3 of 3 picked');
  });

  await test.step('switch the first game to Texas: the final now offers Texas, and its Duke pick is cleared', async () => {
    await pick(1, 'Texas');
    await expect(teamButton(3, 'Duke')).toHaveCount(0);
    await expect(teamButton(3, 'Texas')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('bracket-progress')).toHaveText('2 of 3 picked');
    await pick(3, 'Texas');
  });

  await test.step(`save a tiebreaker of ${TIEBREAKER} total points and submit the bracket`, async () => {
    await expect(page.getByTestId('bracket-submit')).toBeDisabled();
    await page.getByTestId('bracket-tiebreaker-input').fill(String(TIEBREAKER));
    const saved = await submitAndRead<{ tiebreakerValue: number | null; canSubmit: boolean }>(page, 'bracket-tiebreaker-save', 'PUT', gamePicksPath());
    expect(saved).toMatchObject({ tiebreakerValue: TIEBREAKER, canSubmit: true });
    await expect(page.getByTestId('bracket-submit')).toBeEnabled();
    const submitted = await submitAndRead<{ status: string }>(page, 'bracket-submit', 'POST', `${gamePicksPath()}/submit`);
    expect(submitted.status).toBe('SUBMITTED');
    await expect(page.getByTestId('bracket-submitted')).toBeVisible();
    await expect(page.getByTestId('bracket-status')).toHaveText('Submitted');
  });

  await test.step('the member logs out', async () => {
    await logOut(page);
  });
});
