import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminApiHeaders, expectOk, type AuthHeaders } from './helpers/admin-api';
import { adminSignIn, logOut, readAdminCredentials, type AdminCredentials } from './helpers/admin-session';
import { submitAndRead } from './helpers/browser-writes';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { generatePassword, registerFreshUser } from './helpers/user-session';

/**
 * #711 — the squares pool journey: the root admin releases an American football event of one game
 * through the API (act 1: the setting, not the thing under test); a new commissioner creates a
 * Squares contest on that game and opens it (act 2); a new member joins by link, enters, and
 * claims a box, which the grid then shows under their name (act 3); and the commissioner draws the
 * numbers, which appear along the grid's edges (act 4).
 *
 * The golden journey's shape and safety rules, for the same reasons (its header has them in full):
 * a serial file sharing module state between acts, run-unique names, assertions only about what
 * this run created, and teardown of every attempt in `afterAll`. The game is on a fixed far-future
 * date, so nothing depends on the day the suite runs. Not tagged `@smoke`.
 */

const KICKOFF = '2099-02-07T23:30:00.000Z';
const TEAMS = { away: 'Chiefs', home: 'Eagles' } as const;

/** Two tiers of one team each: an NFL event starts on seven, more than a two-team field fills. */
const TWO_TIERS = [
  { tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1 },
  { tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 },
];

/** The app's default "Standard" pricing profile, as an event stores it once priced. */
const STANDARD_PRICING = {
  profileName: 'Standard',
  salaryCap: 50_000,
  unit: 100,
  topSharePercent: 24,
  floorSharePercent: 12,
  steepness: 4,
};

type SquaresJourneyState = {
  run: JourneyRun;
  commissionerPassword?: string;
  eventId?: string;
  gameId?: string;
  leagueId?: string;
  contestId?: string;
  joinUrl?: string;
  entryId?: string;
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

let admin: AdminCredentials | undefined;
let journey: SquaresJourneyState | undefined;
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

function requireJourney(): Required<SquaresJourneyState> {
  if (!journey) {
    throw new Error('act 1 did not record this attempt; the later acts have nothing to consume');
  }
  return journey as Required<SquaresJourneyState>;
}

function teamName(run: JourneyRun, name: string): string {
  return `${run.playerNamePrefix} ${name}`;
}

async function postJson<T>(api: APIRequestContext, headers: AuthHeaders, path: string, data: unknown, method: 'post' | 'put' = 'post'): Promise<T> {
  const options = data === undefined ? { headers } : { headers, data };
  const response = await expectOk(api[method](path, options), `${method.toUpperCase()} ${path}`);
  return (await response.json()) as T;
}

test('act 1: the root admin releases an American football event of one game between two teams', async ({ playwright }, testInfo) => {
  test.setTimeout(120_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const run: JourneyRun = {
    runId,
    sport: 'AMERICAN_FOOTBALL',
    tourName: `E2E Squares League ${runId}`,
    playerNamePrefix: `E2E Squares Club ${runId}`,
    tournamentName: `E2E Squares Bowl ${runId}`,
    commissioner: {
      username: `e2e-sc-${runId}`,
      email: `e2e-sc-${runId}@e2e.invalid`,
      firstName: 'E2E',
      lastName: `Squares Commissioner ${runId}`,
    },
    member: {
      username: `e2e-sm-${runId}`,
      email: `e2e-sm-${runId}@e2e.invalid`,
      firstName: 'E2E',
      lastName: `Squares Member ${runId}`,
    },
    leagueName: `E2E Squares Pool League ${runId}`,
    leagueCode: `E2ES${runId.toUpperCase()}`,
    contestName: `E2E Squares ${runId}`,
    squadName: `E2E Boxers ${runId}`,
  };
  runs.push(run);
  journey = { run };
  console.log(`[squares journey ${runId}] event="${run.tournamentName}" league=${run.leagueCode}`);

  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const headers = await adminApiHeaders(api, credentials);
    if (!headers) {
      throw new Error('the root admin could not sign in to the API');
    }

    const { sports } = await (await expectOk(api.get('/api/v1/sports/', { headers }), 'list sports')).json() as {
      sports: Array<{ id: string; sport: string }>;
    };
    const sportId = sports.find((row) => row.sport === 'AMERICAN_FOOTBALL')?.id;
    if (!sportId) {
      throw new Error('American football is not in the sports table');
    }

    const { sportLeague } = await postJson<{ sportLeague: { id: string } }>(api, headers, '/api/v1/sport-leagues/', {
      sport: 'AMERICAN_FOOTBALL',
      name: run.tourName,
    });
    const { event } = await postJson<{ event: { id: string } }>(api, headers, '/api/v1/events/', {
      sportLeagueId: sportLeague.id,
      eventYear: 2099,
      name: run.tournamentName,
      startDate: KICKOFF,
      rounds: 1,
      autoLifecycleEnabled: false,
    });
    journey.eventId = event.id;
    const teams = [TEAMS.home, TEAMS.away];
    const participantIds: string[] = [];
    for (const name of teams) {
      const { participant } = await postJson<{ participant: { id: string } }>(api, headers, '/api/v1/participants/', {
        sportId,
        participantType: 'TEAM',
        name: teamName(run, name),
      });
      participantIds.push(participant.id);
    }
    await postJson(api, headers, `/api/v1/events/${event.id}/participants`, { participantIds });
    // Release asks every event for its roster setup too: seeds, tiers and prices.
    await postJson(api, headers, `/api/v1/events/${event.id}/participants/upload`, {
      rows: teams.map((name, seed) => ({ playerName: teamName(run, name), seedNumber: seed + 1, oddsToWin: 2 + seed * 5 })),
    });
    await postJson(api, headers, `/api/v1/events/${event.id}/tiers`, { tiers: TWO_TIERS }, 'put');
    await postJson(api, headers, `/api/v1/events/${event.id}/tiers/auto-assign`, { source: 'ODDS', tierSize: 1 });
    await postJson(api, headers, `/api/v1/events/${event.id}/prices/auto-assign`, STANDARD_PRICING);

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
    const { matches } = await postJson<{ matches: Array<{ id: string }> }>(api, headers, `/api/v1/events/${event.id}/bracket`, {
      matches: [
        { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: rowOf(TEAMS.home), awaySportEventParticipantId: rowOf(TEAMS.away), isNeutralSite: true, scheduledDate: KICKOFF, advancesTo: null },
      ],
    }, 'put');
    journey.gameId = matches[0]?.id;
    const released = await postJson<{ event: { status: string } }>(api, headers, `/api/v1/events/${event.id}/release`, undefined);
    expect(released.event.status).toBe('SCHEDULED');
  } finally {
    await api.dispose();
  }
});

test('act 2: a new commissioner creates a Squares contest on the game, opens it, and hands out a join link', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run } = state;

  await test.step('a fresh commissioner registers and creates a league', async () => {
    await page.goto('/');
    await page.getByTestId('auth-mode-register').click();
    state.commissionerPassword = generatePassword();
    await registerFreshUser(page, run.commissioner, state.commissionerPassword);
    await page.getByTestId('welcome-create-league').click();
    await page.getByTestId('create-league-code').fill(run.leagueCode);
    await page.getByTestId('create-league-name').fill(run.leagueName);
    await page.getByTestId('create-league-next').click();
    const created = await submitAndRead<{ league: { id: string } }>(page, 'create-league-submit', 'POST', '/api/v1/leagues');
    state.leagueId = created.league.id;
    await expect(page.getByTestId('league-home')).toBeVisible();
  });

  await test.step('choose American football, the event, the Squares format and its game', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
    await expect(page.getByTestId('create-contest-page')).toBeVisible();
    await page.getByTestId('contest-sport-AMERICAN_FOOTBALL').click();
    await page.getByTestId('contest-format-SQUARES').click();
    const event = page.getByTestId(`contest-event-${state.eventId}`);
    await event.click();
    await expect(event).toBeChecked();
    await expect(page.getByTestId('contest-squares-game')).toHaveValue(state.gameId);
    await expect(page.getByTestId('contest-squares-game')).toContainText(`${teamName(run, TEAMS.away)} vs ${teamName(run, TEAMS.home)}`);
    await page.getByTestId('contest-name').fill(run.contestName);
  });

  await test.step('create the squares contest on that game', async () => {
    const created = await submitAndRead<{ contest: { id: string; contestFormat: string; selectionType: string } }>(
      page,
      'create-contest-submit',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contests`,
    );
    expect(created.contest.contestFormat).toBe('SQUARES');
    expect(created.contest.selectionType).toBe('SQUARES');
    state.contestId = created.contest.id;
    await expect(page.getByTestId('manage-contest-page')).toBeVisible();
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

test('act 3: a new member joins, enters, and claims a box, which the grid shows under their name', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run } = state;

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

  await test.step('create an entry and land on the empty grid', async () => {
    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    const created = await submitAndRead<{ entry: { id: string } }>(
      page,
      'contest-board-create-entry',
      'POST',
      `/api/v1/contests/${state.contestId}/entries/me`,
    );
    state.entryId = created.entry.id;
    await expect(page.getByTestId('squares-entry-page')).toBeVisible();
    await expect(page.getByTestId('squares-claimed-count')).toHaveText('0 of 10 boxes claimed');
  });

  await test.step('claim the box in row 3, column 5', async () => {
    const board = await submitAndRead<{ boxes: Array<{ rowIndex: number; columnIndex: number; contestEntryId: string }> }>(
      page,
      'squares-box-2-4',
      'PUT',
      `/api/v1/selections/${state.contestId}/squares/2/4`,
    );
    expect(board.boxes).toEqual([expect.objectContaining({ rowIndex: 2, columnIndex: 4, contestEntryId: state.entryId })]);
    await expect(page.getByTestId('squares-box-2-4')).toContainText(run.squadName);
    await expect(page.getByTestId('squares-box-2-4')).toHaveAttribute('data-mine', 'true');
    await expect(page.getByTestId('squares-claimed-count')).toHaveText('1 of 10 boxes claimed');
  });

  await test.step('the member logs out', async () => {
    await logOut(page);
  });
});

test('act 4: the commissioner draws the numbers, and the digits appear along the grid with the box still the member\'s', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run } = state;

  await adminSignIn(page, { identifier: run.commissioner.username, password: state.commissionerPassword });
  await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}/leaderboard`);
  await expect(page.getByTestId('squares-board')).toBeVisible();
  await expect(page.getByTestId('squares-row-digit-0')).toHaveText('');

  await page.getByTestId('squares-draw').click();
  const drawn = await submitAndRead<{ digits: { rowDigits: number[]; columnDigits: number[] } | null }>(
    page,
    'squares-draw-confirm',
    'POST',
    `/api/v1/selections/${state.contestId}/squares/draw`,
  );
  expect([...(drawn.digits?.rowDigits ?? [])].sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const [index, digit] of (drawn.digits?.rowDigits ?? []).entries()) {
    await expect(page.getByTestId(`squares-row-digit-${index}`)).toHaveText(String(digit));
  }
  await expect(page.getByTestId('squares-column-digit-0')).toHaveText(String(drawn.digits?.columnDigits[0]));
  await expect(page.getByTestId('squares-box-2-4')).toContainText(run.squadName);
  await expect(page.getByTestId('squares-draw')).toHaveCount(0);

  await logOut(page);
});
