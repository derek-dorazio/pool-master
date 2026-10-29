import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminApiHeaders, expectOk, type AuthHeaders } from './helpers/admin-api';
import { logOut, readAdminCredentials, type AdminCredentials } from './helpers/admin-session';
import { submitAndRead } from './helpers/browser-writes';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { registerFreshUser } from './helpers/user-session';

/**
 * #718 — the pick'em pool journey: the root admin sets up two released American football weeks
 * through the API, each one game between two teams (act 1: it is the setting, not the thing under
 * test); a new commissioner creates a Pick'em contest on the first week, adds the season's other
 * week with Add all on its Events page, and opens it (act 2); and a new member joins by link,
 * picks week 1's game, saves the tiebreaker on it, submits the week, and finds the entry on the
 * season leaderboard (act 3).
 *
 * The golden journey's shape and safety rules, for the same reasons (its header has them in full):
 * a serial file sharing module state between acts, run-unique names, assertions only about what
 * this run created, and teardown of every attempt in `afterAll`. The weeks start on fixed
 * far-future dates, so nothing depends on the day the suite runs. Not tagged `@smoke`.
 */

/** Each week's one game, away team first: the week's field is its two teams. */
const WEEKS: ReadonlyArray<{ start: string; away: string; home: string }> = [
  { start: '2099-09-13T17:00:00.000Z', away: 'Bills', home: 'Chiefs' },
  { start: '2099-09-20T17:00:00.000Z', away: 'Cowboys', home: 'Eagles' },
];

/** Two tiers of one team each: an NFL event starts on seven, more than a two-team field fills. */
const TWO_TIERS = [
  { tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1 },
  { tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 },
];
const TIEBREAKER = 44;

/** The app's default "Standard" pricing profile, as an event stores it once priced. */
const STANDARD_PRICING = {
  profileName: 'Standard',
  salaryCap: 50_000,
  unit: 100,
  topSharePercent: 24,
  floorSharePercent: 12,
  steepness: 4,
};

type PickEmJourneyState = {
  run: JourneyRun;
  eventIds?: string[];
  /** Week 1's field-row ids by team name. */
  week1FieldRowIds?: Record<string, string>;
  leagueId?: string;
  contestId?: string;
  joinUrl?: string;
  entryId?: string;
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

let admin: AdminCredentials | undefined;
let journey: PickEmJourneyState | undefined;
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

function requireJourney(): Required<PickEmJourneyState> {
  if (!journey) {
    throw new Error('act 1 did not record this attempt; the later acts have nothing to consume');
  }
  return journey as Required<PickEmJourneyState>;
}

function teamName(run: JourneyRun, name: string): string {
  return `${run.playerNamePrefix} ${name}`;
}

async function postJson<T>(api: APIRequestContext, headers: AuthHeaders, path: string, data: unknown, method: 'post' | 'put' = 'post'): Promise<T> {
  const options = data === undefined ? { headers } : { headers, data };
  const response = await expectOk(api[method](path, options), `${method.toUpperCase()} ${path}`);
  return (await response.json()) as T;
}

function weekName(run: JourneyRun, index: number): string {
  return index === 0 ? run.tournamentName : `E2E Pickem Week ${index + 1} ${run.runId}`;
}

test('act 1: the root admin releases two American football weeks, each one game between two teams', async ({ playwright }, testInfo) => {
  test.setTimeout(120_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const run: JourneyRun = {
    runId,
    sport: 'AMERICAN_FOOTBALL',
    tourName: `E2E Football League ${runId}`,
    playerNamePrefix: `E2E Club ${runId}`,
    tournamentName: `E2E Pickem Week 1 ${runId}`,
    moreTournamentNames: [`E2E Pickem Week 2 ${runId}`],
    commissioner: {
      username: `e2e-pc-${runId}`,
      email: `e2e-pc-${runId}@e2e.invalid`,
      firstName: 'E2E',
      lastName: `Pickem Commissioner ${runId}`,
    },
    member: {
      username: `e2e-pm-${runId}`,
      email: `e2e-pm-${runId}@e2e.invalid`,
      firstName: 'E2E',
      lastName: `Pickem Member ${runId}`,
    },
    leagueName: `E2E Pickem League ${runId}`,
    leagueCode: `E2EP${runId.toUpperCase()}`,
    contestName: `E2E Pickem Pool ${runId}`,
    squadName: `E2E Pickers ${runId}`,
  };
  runs.push(run);
  journey = { run };
  console.log(`[pick'em journey ${runId}] weeks="${run.tournamentName}" league=${run.leagueCode}`);

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
    const eventIds: string[] = [];
    for (const [index, week] of WEEKS.entries()) {
      const { event } = await postJson<{ event: { id: string } }>(api, headers, '/api/v1/events/', {
        sportLeagueId: sportLeague.id,
        eventYear: 2099,
        name: weekName(run, index),
        startDate: week.start,
        rounds: 1,
        autoLifecycleEnabled: false,
      });
      eventIds.push(event.id);
      const teams = [week.home, week.away];
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
      if (index === 0) {
        journey.week1FieldRowIds = Object.fromEntries(teams.map((name) => [name, rowOf(name)]));
      }
      // The week's one game, which is also its last and so its tiebreaker game.
      await postJson(api, headers, `/api/v1/events/${event.id}/bracket`, {
        matches: [
          { matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: rowOf(week.home), awaySportEventParticipantId: rowOf(week.away), isNeutralSite: false, scheduledDate: week.start, advancesTo: null },
        ],
      }, 'put');
      const released = await postJson<{ event: { status: string } }>(api, headers, `/api/v1/events/${event.id}/release`, undefined);
      expect(released.event.status).toBe('SCHEDULED');
    }
    journey.eventIds = eventIds;
  } finally {
    await api.dispose();
  }
});

test('act 2: a new commissioner creates a Pick\'em contest on week 1, adds the other week with Add all, opens it, and hands out a join link', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run } = state;
  const [week1Id, week2Id] = state.eventIds;

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

  await test.step('choose American football, week 1 and the Pick\'em format, straight up', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
    await expect(page.getByTestId('create-contest-page')).toBeVisible();
    await page.getByTestId('contest-sport-AMERICAN_FOOTBALL').click();
    const week1 = page.getByTestId(`contest-event-${week1Id}`);
    await expect(week1).toContainText(run.tournamentName);
    await week1.click();
    await expect(week1).toBeChecked();
    await page.getByTestId('contest-format-PICK_EM').click();
    await expect(page.getByTestId('contest-pick-em-mode-STRAIGHT_UP')).toBeChecked();
    await page.getByTestId('contest-name').fill(run.contestName);
  });

  await test.step('create the contest as a prediction contest with the pick\'em selection type', async () => {
    const created = await submitAndRead<{ contest: { id: string; contestFormat: string; selectionType: string } }>(
      page,
      'create-contest-submit',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contests`,
    );
    expect(created.contest.contestFormat).toBe('PREDICTION');
    expect(created.contest.selectionType).toBe('PICK_EM');
    state.contestId = created.contest.id;
    await expect(page.getByTestId('manage-contest-page')).toBeVisible();
    await expect(page.getByTestId('manage-contest-format')).toContainText('Pick’em');
  });

  await test.step('add the season\'s other week with Add all on the Events page', async () => {
    await page.getByTestId('manage-contest-events-edit').click();
    await expect(page.getByTestId('contest-events-page')).toBeVisible();
    await page.getByTestId('contest-events-add-all').click();
    await expect(page.getByTestId(`contest-events-option-${week2Id}`)).toBeChecked();
    const saved = await submitAndRead<{ contest: { sportEvents: { sportEventId: string }[] } }>(
      page,
      'contest-events-save',
      'PUT',
      `/api/v1/leagues/${state.leagueId}/contest-management/contests/${state.contestId}/sport-events`,
    );
    expect(saved.contest.sportEvents.map((sportEvent) => sportEvent.sportEventId)).toEqual([week1Id, week2Id]);
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

test('act 3: a new member joins, picks week 1\'s game, saves the tiebreaker on it, submits the week and finds the entry on the season leaderboard', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run, week1FieldRowIds } = state;
  const [week1Id] = state.eventIds;
  const gamePicksPath = () => `/api/v1/selections/${state.contestId}/entries/${state.entryId}/events/${week1Id}/game-picks`;

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

  await test.step('create an entry and land on week 1, not yet submitted', async () => {
    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    const created = await submitAndRead<{ entry: { id: string } }>(
      page,
      'contest-board-create-entry',
      'POST',
      `/api/v1/contests/${state.contestId}/entries/me`,
    );
    state.entryId = created.entry.id;
    await expect(page.getByTestId('pick-em-entry-page')).toBeVisible();
    await expect(page.getByTestId('pick-em-week-switcher')).toHaveValue(week1Id);
    await expect(page.getByTestId('pick-em-picked-count')).toHaveText('0 of 1 picked');
    await expect(page.getByTestId('pick-em-not-submitted-warning')).toBeVisible();
  });

  await test.step('pick the Bills', async () => {
    const billsTestId = `pick-em-game-1-team-${week1FieldRowIds['Bills']}`;
    await submitAndRead(page, billsTestId, 'PUT', gamePicksPath());
    await expect(page.getByTestId(billsTestId)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pick-em-picked-count')).toHaveText('1 of 1 picked');
  });

  await test.step(`save a tiebreaker of ${TIEBREAKER} total points on the game and submit the week`, async () => {
    await expect(page.getByTestId('pick-em-submit')).toBeDisabled();
    await page.getByTestId('pick-em-tiebreaker-input').fill(String(TIEBREAKER));
    const saved = await submitAndRead<{ tiebreakerValue: number | null; canSubmit: boolean }>(page, 'pick-em-tiebreaker-save', 'PUT', gamePicksPath());
    expect(saved).toMatchObject({ tiebreakerValue: TIEBREAKER, canSubmit: true });
    await expect(page.getByTestId('pick-em-submit')).toBeEnabled();
    const submitted = await submitAndRead<{ status: string }>(page, 'pick-em-submit', 'POST', `${gamePicksPath()}/submit`);
    expect(submitted.status).toBe('SUBMITTED');
    await expect(page.getByTestId('pick-em-submitted')).toBeVisible();
    await expect(page.getByTestId('contest-entry-status')).toHaveAccessibleName('Entry status: Submitted');
  });

  await test.step('the season leaderboard lists the entry, with no points before the first kickoff', async () => {
    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}/leaderboard`);
    await expect(page.getByTestId('pick-em-leaderboard-table')).toBeVisible();
    await expect(page.getByTestId(`pick-em-leaderboard-row-${state.entryId}`)).toBeVisible();
    await expect(page.getByTestId(`pick-em-leaderboard-total-${state.entryId}`)).toHaveText('0 pts');
    await expect(page.getByTestId('pick-em-leaderboard-not-started')).toBeVisible();
  });

  await test.step('the member logs out', async () => {
    await logOut(page);
  });
});
