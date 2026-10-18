import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  adminSignIn,
  logOut,
  readAdminCredentials,
  type AdminCredentials,
} from './helpers/admin-session';
import { readCsrfToken, submitAndRead } from './helpers/browser-writes';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { registerFreshUser } from './helpers/user-session';

/**
 * #749 — the knockout journey, on the 2025 WNBA playoffs as they were played (seeds and series
 * results from `basketball-2025-wnba-playoffs-test.json`): the root admin builds the playoffs on
 * the shared Manage pages (a league, the eight teams, the tournament, its field with seeds and
 * odds, tiers from those odds, prices), loads the bracket with one pairing still open, completes
 * that pairing on the bracket tab, and releases it (act 1); a new commissioner creates a
 * basketball contest on it scored 1, 2, 4 a round with the seed-difference upset bonus (act 2);
 * a new member joins by link and picks one team from each tier, each shown by its seed (act 3);
 * and the root admin starts the tournament and names each series' winner on the bracket tab,
 * which moves the knockout leaderboard round by round, then completes it, which settles the
 * contest (act 4).
 *
 * The golden journey's shape and its safety rules, for the same reasons (its header has them in
 * full): a serial file sharing module state between acts, run-unique names, assertions only about
 * what this run created, and teardown of every attempt in `afterAll`. Nothing here is tagged
 * `@smoke`: act 4 writes results and settles a contest, which only the local stack should see.
 * The tournament starts a week from the run, so nothing depends on today's date: the bracket's
 * games carry no times.
 */

/** The 2025 WNBA playoff field, by seed: index 0 is the 1 seed. Odds to win are the test file's. */
const TEAMS: ReadonlyArray<{ name: string; seed: number; oddsToWin: number }> = [
  { name: 'Minnesota Lynx', seed: 1, oddsToWin: 2.5 },
  { name: 'Las Vegas Aces', seed: 2, oddsToWin: 3.5 },
  { name: 'Atlanta Dream', seed: 3, oddsToWin: 5 },
  { name: 'Phoenix Mercury', seed: 4, oddsToWin: 7 },
  { name: 'New York Liberty', seed: 5, oddsToWin: 8 },
  { name: 'Indiana Fever', seed: 6, oddsToWin: 15 },
  { name: 'Seattle Storm', seed: 7, oddsToWin: 25 },
  { name: 'Golden State Valkyries', seed: 8, oddsToWin: 40 },
];

/**
 * Basketball's four tiers don't fill at 16 a tier from eight teams, so tiers from odds spread
 * them evenly: two a tier, the 1 and 2 seeds first.
 */
const TIER_OF_SEED: readonly number[] = [1, 1, 2, 2, 3, 3, 4, 4];

type Side = 'HOME' | 'AWAY';

/**
 * The bracket as it was played, by seed (null for a side an earlier series fills). The higher
 * seed is at home. Match 4's away side, the 7 seed, is left open when the bracket loads, so the
 * admin completes it on the bracket tab before release.
 */
const BRACKET: ReadonlyArray<{
  matchNumber: number;
  roundNumber: number;
  home: number | null;
  away: number | null;
  advancesTo: { matchNumber: number; side: Side } | null;
  winner: Side;
}> = [
  { matchNumber: 1, roundNumber: 1, home: 1, away: 8, advancesTo: { matchNumber: 5, side: 'HOME' }, winner: 'HOME' },
  { matchNumber: 2, roundNumber: 1, home: 4, away: 5, advancesTo: { matchNumber: 5, side: 'AWAY' }, winner: 'HOME' },
  { matchNumber: 3, roundNumber: 1, home: 3, away: 6, advancesTo: { matchNumber: 6, side: 'AWAY' }, winner: 'AWAY' },
  { matchNumber: 4, roundNumber: 1, home: 2, away: 7, advancesTo: { matchNumber: 6, side: 'HOME' }, winner: 'HOME' },
  { matchNumber: 5, roundNumber: 2, home: null, away: null, advancesTo: { matchNumber: 7, side: 'AWAY' }, winner: 'AWAY' },
  { matchNumber: 6, roundNumber: 2, home: null, away: null, advancesTo: { matchNumber: 7, side: 'HOME' }, winner: 'HOME' },
  { matchNumber: 7, roundNumber: 3, home: null, away: null, advancesTo: null, winner: 'HOME' },
];
const OPEN_PAIRING = { matchNumber: 4, side: 'AWAY' as Side, seed: 7 };
const ROUND_COUNT = 3;

/** The commissioner's scoring: a win is 1 in the first round, 2 in the semifinals, 4 in the final. */
const ROUND_VALUES: readonly number[] = [1, 2, 4];

/** The member's pick in each tier, by seed: the Aces, the Mercury, the Fever and the Storm. */
const PICKED_SEEDS: readonly number[] = [2, 4, 6, 7];

/**
 * What the picks score, with the upset bonus. After the first round: the Aces 1, the Mercury 1,
 * the Fever 1 + (6 - 3) = 4 for beating the 3 seed, and the Storm 0, out to the Aces. After the
 * final: the Aces 1 + 2 + 4 = 7 as champions, the Mercury 1 + 2 + (4 - 1) = 6 for beating the 1
 * seed in the semifinals, the Fever still 4. Without the bonus the entry would score 11, so 17
 * can only come from the commissioner's settings.
 */
const POINTS_AFTER_ROUND_1: Readonly<Record<number, number>> = { 2: 1, 4: 1, 6: 4, 7: 0 };
const POINTS_AFTER_FINAL: Readonly<Record<number, number>> = { 2: 7, 4: 6, 6: 4, 7: 0 };
const EXPECTED_TOTAL_AFTER_ROUND_1 = 6;
const EXPECTED_TOTAL = 17;

type KnockoutJourneyState = {
  run: JourneyRun;
  teamIds?: string[];
  eventId?: string;
  /** Field-entry ids by seed: index 0 is the 1 seed. */
  fieldEntryIds?: string[];
  leagueId?: string;
  contestId?: string;
  joinUrl?: string;
  entryId?: string;
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

let admin: AdminCredentials | undefined;
let journey: KnockoutJourneyState | undefined;
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

function requireJourney(): Required<KnockoutJourneyState> {
  if (!journey) {
    throw new Error('act 1 did not record this attempt; the later acts have nothing to consume');
  }
  return journey as Required<KnockoutJourneyState>;
}

function teamName(run: JourneyRun, seed: number): string {
  return `${run.playerNamePrefix} ${TEAMS[seed - 1].name}`;
}

test('act 1: the root admin builds the 2025 WNBA playoffs — league, eight teams, the tournament, its seeded field, tiers and prices — loads the bracket, completes its open pairing on the bracket tab, and releases it', async ({ page }) => {
  test.setTimeout(180_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const run: JourneyRun = {
    runId,
    sport: 'BASKETBALL',
    tourName: `E2E Playoff League ${runId}`,
    playerNamePrefix: `E2E Team ${runId}`,
    tournamentName: `E2E Playoffs ${runId}`,
    commissioner: {
      username: `e2e-kc-${runId}`,
      email: `e2e-kc-${runId}@e2e.invalid`,
      firstName: 'E2E',
      lastName: `Knockout Commissioner ${runId}`,
    },
    member: {
      username: `e2e-km-${runId}`,
      email: `e2e-km-${runId}@e2e.invalid`,
      firstName: 'E2E',
      lastName: `Knockout Member ${runId}`,
    },
    leagueName: `E2E Bracket League ${runId}`,
    leagueCode: `E2EK${runId.toUpperCase()}`,
    contestName: `E2E Playoff Picks ${runId}`,
    squadName: `E2E Bench ${runId}`,
  };
  runs.push(run);
  journey = { run };
  console.log(`[knockout journey ${runId}] tournament="${run.tournamentName}" league=${run.leagueCode}`);

  await test.step('root admin signs in, and Manage lists basketball', async () => {
    await adminSignIn(page, credentials);
    await page.goto('/manage');
    await page.getByTestId('root-admin-manage-menu-basketball').click();
    await expect(page).toHaveURL(/\/manage\/sports\/basketball\/events$/);
    await expect(page.getByTestId('root-admin-sport-event-list-page')).toBeVisible();
  });

  const leagueId = await test.step('create a basketball league', async () => {
    await page.goto('/manage/sports/basketball/leagues');
    await page.getByTestId('root-admin-sport-league-list-new').click();
    await page.getByTestId('root-admin-sport-league-list-new-name').fill(run.tourName);
    const created = await submitAndRead<{ sportLeague: { id: string } }>(
      page,
      'root-admin-sport-league-list-new-save',
      'POST',
      '/api/v1/sport-leagues',
    );
    await page.getByTestId('root-admin-sport-league-list-search').fill(run.tourName);
    await expect(page.getByTestId(`root-admin-sport-league-row-${created.sportLeague.id}`)).toBeVisible();
    return created.sportLeague.id;
  });

  const teamIds = await test.step(`create the ${TEAMS.length} teams`, async () => {
    await page.goto('/manage/sports/basketball/participants');
    const ids: string[] = [];
    for (const team of TEAMS) {
      await page.getByTestId('root-admin-participant-list-new').click();
      await page.getByTestId('root-admin-participant-list-new-name').fill(teamName(run, team.seed));
      const created = await submitAndRead<{ participant: { id: string } }>(
        page,
        'root-admin-participant-list-new-save',
        'POST',
        '/api/v1/participants',
      );
      ids.push(created.participant.id);
    }
    await page.getByTestId('root-admin-participant-list-search').fill(run.playerNamePrefix);
    for (const id of ids) {
      await expect(page.getByTestId(`root-admin-participant-row-${id}`)).toBeVisible();
    }
    return ids;
  });
  journey.teamIds = teamIds;

  const eventId = await test.step(`create the ${ROUND_COUNT}-round tournament on the league, a week out`, async () => {
    const start = addDays(new Date(), 7);
    start.setHours(19, 0, 0, 0);
    await page.goto('/manage/sports/basketball/events/new');
    await page.getByTestId('root-admin-sport-event-create-tour').selectOption(leagueId);
    await page.getByTestId('root-admin-sport-event-create-event-year').fill(String(start.getFullYear()));
    await page.getByTestId('root-admin-sport-event-create-name').fill(run.tournamentName);
    await page.getByTestId('root-admin-sport-event-create-start').fill(dateTimeInput(start));
    // The form starts from March Madness's six rounds; three series make the WNBA playoffs.
    await expect(page.getByTestId('root-admin-sport-event-create-rounds')).toHaveValue('6');
    await page.getByTestId('root-admin-sport-event-create-rounds').fill(String(ROUND_COUNT));
    const created = await submitAndRead<{ event: { id: string; sport: string } }>(
      page,
      'root-admin-sport-event-create-submit',
      'POST',
      '/api/v1/events',
    );
    expect(created.event.sport).toBe('BASKETBALL');
    await expect(page).toHaveURL(new RegExp(`/manage/sports/basketball/events/${created.event.id}$`));
    return created.event.id;
  });
  journey.eventId = eventId;

  await test.step(`enter the ${TEAMS.length} teams in the field`, async () => {
    await page.goto(`/manage/sports/basketball/events/${eventId}/field`);
    await page.getByTestId('root-admin-event-field-add').click();
    await page.getByTestId('root-admin-event-field-add-search').fill(runId);
    for (const id of teamIds) {
      await page.getByTestId(`root-admin-event-field-add-search-select-${id}`).check();
    }
    await submitAndRead(page, 'root-admin-event-field-add-submit', 'POST', `/api/v1/events/${eventId}/participants`);
    await expect(page.getByTestId('root-admin-event-field-add-result')).toBeVisible();
    await page.getByTestId('root-admin-event-field-add-done').click();
  });

  const fieldEntryIds = await test.step('set each team\'s seed and odds to win in the field grid', async () => {
    // Read straight from the API, for each team's field-entry id (the golden journey's tiers step
    // has the reason it is not sniffed from the page).
    const fieldResponse = await page.request.get(`/api/v1/events/${eventId}/participants`);
    expect(fieldResponse.ok(), `GET the field answered ${fieldResponse.status()}`).toBe(true);
    const field = (await fieldResponse.json()) as { participants: { id: string; participantId: string }[] };
    const entryIds = teamIds.map((teamId) => {
      const entry = field.participants.find((candidate) => candidate.participantId === teamId);
      if (!entry) {
        throw new Error(`team ${teamId} is not in the field`);
      }
      return entry.id;
    });

    for (const [index, entryId] of entryIds.entries()) {
      await page.getByTestId(`root-admin-event-field-seedNumber-${entryId}`).fill(String(TEAMS[index].seed));
      await page.getByTestId(`root-admin-event-field-oddsToWin-${entryId}`).fill(String(TEAMS[index].oddsToWin));
    }
    await submitAndRead(page, 'root-admin-event-field-save', 'PATCH', `/api/v1/events/${eventId}/participants`);
    for (const [index, entryId] of entryIds.entries()) {
      await expect(page.getByTestId(`root-admin-event-field-seedNumber-${entryId}`)).toHaveValue(String(TEAMS[index].seed));
    }
    return entryIds;
  });
  journey.fieldEntryIds = fieldEntryIds;

  await test.step('tier the field from its odds, two teams a tier, and price it', async () => {
    await page.goto(`/manage/sports/basketball/events/${eventId}/tiers`);
    await page.getByTestId('root-admin-tier-auto-odds').click();
    await submitAndRead(page, 'root-admin-tier-auto-tiers-confirm', 'POST', `/api/v1/events/${eventId}/tiers/auto-assign`);
    for (const [index, entryId] of fieldEntryIds.entries()) {
      await expect(
        page
          .getByTestId(`root-admin-tier-column-tier-${TIER_OF_SEED[index]}`)
          .getByTestId(`root-admin-tier-card-${entryId}`),
      ).toBeVisible();
    }
    await page.getByTestId('root-admin-tier-auto-prices').click();
    await expect(page.getByTestId('root-admin-tier-auto-prices-preview')).toBeVisible();
    await submitAndRead(page, 'root-admin-tier-auto-prices-confirm', 'POST', `/api/v1/events/${eventId}/prices/auto-assign`);
    await expect(page.getByTestId('root-admin-tiers-pricing')).toContainText('Priced with');
  });

  await test.step('load the bracket with the 2 seed\'s first-round opponent still open, as a data file would before the play-in is decided', async () => {
    // Manage has no bracket upload: a bracket arrives from a sport data file through the API.
    // The bracket tab is what the admin works with once it is loaded.
    const entryOfSeed = (seed: number | null) => (seed === null ? null : fieldEntryIds[seed - 1]);
    const response = await page.request.put(`/api/v1/events/${eventId}/bracket`, {
      headers: { 'x-csrf-token': await readCsrfToken(page) },
      data: {
        matches: BRACKET.map((match) => ({
          matchNumber: match.matchNumber,
          roundNumber: match.roundNumber,
          homeSportEventParticipantId: entryOfSeed(match.home),
          awaySportEventParticipantId: match.matchNumber === OPEN_PAIRING.matchNumber && OPEN_PAIRING.side === 'AWAY'
            ? null
            : entryOfSeed(match.away),
          isNeutralSite: false,
          scheduledDate: null,
          advancesTo: match.advancesTo,
        })),
      },
    });
    expect(response.ok(), `PUT the bracket answered ${response.status()} ${await response.text()}`).toBe(true);
  });

  await test.step('the bracket tab shows each round by the sport\'s names and the teams by seed; the open pairing is completed there', async () => {
    await page.goto(`/manage/sports/basketball/events/${eventId}/results`);
    for (let roundNumber = 1; roundNumber <= ROUND_COUNT; roundNumber += 1) {
      await expect(page.getByTestId(`root-admin-bracket-round-${roundNumber}`)).toBeVisible();
    }
    // Not released, so pairings can still change and no winner can be named.
    await expect(page.getByTestId('root-admin-bracket-help')).toContainText('Pairings can change');
    await expect(page.getByTestId('root-admin-bracket-pairing-1')).toHaveText(`(8) ${teamName(run, 8)} @ (1) ${teamName(run, 1)}`);
    await expect(page.getByTestId('root-admin-bracket-pairing-5')).toHaveText('Winner of game 2 @ Winner of game 1');
    await expect(page.getByTestId('root-admin-bracket-winner-1-HOME')).toHaveCount(0);

    const { matchNumber, side, seed } = OPEN_PAIRING;
    await expect(page.getByTestId(`root-admin-bracket-pairing-${matchNumber}`)).toContainText('To be decided');
    await page.getByTestId(`root-admin-bracket-edit-${matchNumber}`).click();
    await page.getByTestId(`root-admin-bracket-side-${matchNumber}-${side}`).selectOption(fieldEntryIds[seed - 1]);
    await submitAndRead(
      page,
      `root-admin-bracket-save-${matchNumber}`,
      'PATCH',
      `/api/v1/events/${eventId}/bracket/matches/${matchNumber}`,
    );
    await expect(page.getByTestId(`root-admin-bracket-pairing-${matchNumber}`))
      .toHaveText(`(7) ${teamName(run, 7)} @ (2) ${teamName(run, 2)}`);
  });

  await test.step('release the tournament for contests', async () => {
    await page.goto(`/manage/sports/basketball/events/${eventId}`);
    await page.getByTestId('root-admin-sport-event-release').click();
    const released = await submitAndRead<{ event: { status: string } }>(
      page,
      'root-admin-sport-event-release-confirm',
      'POST',
      `/api/v1/events/${eventId}/release`,
    );
    expect(released.event.status).toBe('SCHEDULED');
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

test('act 2: a new commissioner creates a basketball contest on the playoffs, one team a tier scored 1, 2, 4 with the upset bonus, opens it, and hands out a join link', async ({ page }) => {
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

  await test.step('choose basketball and the playoffs, then set one team a tier, all four counting', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
    await expect(page.getByTestId('create-contest-page')).toBeVisible();
    await page.getByTestId('contest-sport-BASKETBALL').click();
    const eventChoice = page.getByTestId(`contest-event-${state.eventId}`);
    await expect(eventChoice).toContainText(run.tournamentName);
    await eventChoice.click();
    await expect(eventChoice).toBeChecked();
    await page.getByTestId('contest-tiered-picks-per-tier').fill('1');
    await page.getByTestId('contest-tiered-counted-scores').fill('4');
  });

  await test.step(`score a win ${ROUND_VALUES.join(', ')} by round, add the seed-difference upset bonus, name the contest, and create it`, async () => {
    await page.getByTestId('contest-scoring-round-values').fill(ROUND_VALUES.join(', '));
    await page.getByTestId('contest-scoring-upset-bonus').selectOption('SEED_DIFFERENCE');
    await expect(page.getByTestId('contest-scoring-upset-bonus-multiplier')).toHaveValue('1');
    await page.getByTestId('contest-name').fill(run.contestName);
    const created = await submitAndRead<{ contest: { id: string; sport?: string | null } }>(
      page,
      'create-contest-submit',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contests`,
    );
    expect(created.contest.sport).toBe('BASKETBALL');
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

test('act 3: a new member joins by the link and submits one team from each tier, each offered by its seed, with no tiebreaker to choose', async ({ page }) => {
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

  await test.step('create an entry on the contest', async () => {
    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    const created = await submitAndRead<{ entry: { id: string } }>(
      page,
      'contest-board-create-entry',
      'POST',
      `/api/v1/contests/${state.contestId}/entries/me`,
    );
    state.entryId = created.entry.id;
    await expect(page.getByTestId('contest-entry-builder-heading')).toBeVisible();
  });

  await test.step(`pick seeds ${PICKED_SEEDS.join(', ')}, one from each tier, and submit`, async () => {
    for (const seed of PICKED_SEEDS) {
      const fieldEntryId = state.fieldEntryIds[seed - 1];
      const choice = page.getByTestId(`contest-entry-participant-${fieldEntryId}`);
      await expect(choice).toContainText(`(${seed}) ${teamName(run, seed)}`);
      await submitAndRead(page, `contest-entry-participant-${fieldEntryId}`, 'POST', `/api/v1/selections/${state.contestId}/pick`);
      await expect(page.getByTestId(`contest-entry-selected-${fieldEntryId}`)).toBeVisible();
    }
    await expect(page.getByTestId('contest-entry-tiebreaker-select')).toHaveCount(0);
    await submitAndRead(
      page,
      'contest-entry-submit',
      'POST',
      `/api/v1/selections/${state.contestId}/entries/${state.entryId}/events/${state.eventId}/submit`,
    );
    await expect(page.getByTestId(`contest-board-entry-${state.entryId}`)).toBeVisible();
  });

  await test.step('the member logs out', async () => {
    await logOut(page);
  });
});

test('act 4: the root admin starts the playoffs and names each series\' winner on the bracket tab; the knockout leaderboard follows round by round, and completing the tournament settles the contest', async ({ page }) => {
  test.setTimeout(180_000);
  const state = requireJourney();
  const { run } = state;

  await test.step('root admin signs in and starts the tournament', async () => {
    await adminSignIn(page, readAdminCredentials());
    await moveTournamentTo(page, state.eventId, 'IN_PROGRESS');
  });

  await test.step('name the four first-round winners; each moves on to its semifinal', async () => {
    await page.goto(`/manage/sports/basketball/events/${state.eventId}/results`);
    await expect(page.getByTestId('root-admin-bracket-help')).toContainText('Choose the team that won each game');
    for (const match of BRACKET.filter((candidate) => candidate.roundNumber === 1)) {
      await recordWinner(page, state.eventId, match.matchNumber, match.winner);
    }
    // The semifinals as they were played: the Lynx host the Mercury, the Aces host the Fever.
    await expect(page.getByTestId('root-admin-bracket-pairing-5')).toHaveText(`(4) ${teamName(run, 4)} @ (1) ${teamName(run, 1)}`);
    await expect(page.getByTestId('root-admin-bracket-pairing-6')).toHaveText(`(6) ${teamName(run, 6)} @ (2) ${teamName(run, 2)}`);
  });

  await test.step(`after the first round the entry has ${EXPECTED_TOTAL_AFTER_ROUND_1}, the Fever's upset of the 3 seed among it, and the Storm is out`, async () => {
    const read = await readKnockoutLeaderboard(page, state.contestId, state.entryId);
    expect(read.total).toBe(EXPECTED_TOTAL_AFTER_ROUND_1);
    expect(pointsBySeed(read, state.fieldEntryIds)).toEqual(POINTS_AFTER_ROUND_1);

    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}/leaderboard`);
    await expect(page.getByTestId(`contest-leaderboard-total-${state.entryId}`)).toHaveText(String(EXPECTED_TOTAL_AFTER_ROUND_1));
    // Every entry opens with its picks showing.
    await expect(page.getByTestId(`contest-leaderboard-entry-toggle-${state.entryId}`)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('contest-leaderboard-upset-bonus-header')).toBeVisible();
    const fever = pickOf(read, state.fieldEntryIds, 6);
    const storm = pickOf(read, state.fieldEntryIds, 7);
    await expect(page.getByTestId(`contest-leaderboard-pick-upset-bonus-${state.entryId}-${fever.pickId}`)).toHaveText('3');
    await expect(page.getByTestId(`contest-leaderboard-pick-status-${state.entryId}-${fever.pickId}`)).toHaveText('Alive');
    await expect(page.getByTestId(`contest-leaderboard-pick-status-${state.entryId}-${storm.pickId}`)).toHaveText('Eliminated');
    await expect(page.getByTestId('contest-leaderboard-settled-note')).toHaveCount(0);
  });

  await test.step('name the semifinal and final winners: the Mercury upset the Lynx, and the Aces win it all', async () => {
    await page.goto(`/manage/sports/basketball/events/${state.eventId}/results`);
    for (const match of BRACKET.filter((candidate) => candidate.roundNumber > 1)) {
      await recordWinner(page, state.eventId, match.matchNumber, match.winner);
    }
    await expect(page.getByTestId('root-admin-bracket-pairing-7')).toHaveText(`(4) ${teamName(run, 4)} @ (2) ${teamName(run, 2)}`);
  });

  await test.step('complete the tournament, which settles the contest', async () => {
    await moveTournamentTo(page, state.eventId, 'COMPLETED');
  });

  await test.step(`the settled entry scores ${EXPECTED_TOTAL} with the upset bonus, the Aces are champions, and the leaderboard says it is final`, async () => {
    const managed = await page.request.get(
      `/api/v1/leagues/${state.leagueId}/contest-management/contests/${state.contestId}`,
    );
    expect(managed.ok(), `GET the managed contest answered ${managed.status()}`).toBe(true);
    const { contest } = (await managed.json()) as { contest: { status: string } };
    expect(contest.status).toBe('COMPLETED');

    const read = await readKnockoutLeaderboard(page, state.contestId, state.entryId);
    expect(read.total).toBe(EXPECTED_TOTAL);
    expect(read.position).toBe(1);
    expect(pointsBySeed(read, state.fieldEntryIds)).toEqual(POINTS_AFTER_FINAL);

    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}/leaderboard`);
    await expect(page.getByTestId('contest-leaderboard-settled-note')).toBeVisible();
    await expect(page.getByTestId(`contest-leaderboard-total-${state.entryId}`)).toHaveText(String(EXPECTED_TOTAL));
    // Every entry opens with its picks showing.
    await expect(page.getByTestId(`contest-leaderboard-entry-toggle-${state.entryId}`)).toHaveAttribute('aria-expanded', 'true');
    const aces = pickOf(read, state.fieldEntryIds, 2);
    const mercury = pickOf(read, state.fieldEntryIds, 4);
    await expect(page.getByTestId(`contest-leaderboard-pick-status-${state.entryId}-${aces.pickId}`)).toHaveText('Champion');
    await expect(page.getByTestId(`contest-leaderboard-pick-wins-${state.entryId}-${aces.pickId}`)).toHaveText('3');
    await expect(page.getByTestId(`contest-leaderboard-pick-status-${state.entryId}-${mercury.pickId}`)).toHaveText('Eliminated');
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

type KnockoutPickRead = {
  pickId: string;
  sportEventParticipantId: string;
  knockout: { points: number; wins: number; upsetBonusPoints: number; isAlive: boolean } | null;
};

type KnockoutLeaderboardRead = {
  total: number | null;
  position: number | null;
  picks: KnockoutPickRead[];
};

/** The entry's row of the contest leaderboard, as the API serves it to the signed-in user. */
async function readKnockoutLeaderboard(page: Page, contestId: string, entryId: string): Promise<KnockoutLeaderboardRead> {
  const response = await page.request.get(`/api/v1/contests/${contestId}/leaderboard`);
  expect(response.ok(), `GET the leaderboard answered ${response.status()}`).toBe(true);
  const body = (await response.json()) as {
    scoringDefinitionId: string;
    entries: Array<{ entryId: string; position: number | null; totalScore: number | null; picks: KnockoutPickRead[] }>;
  };
  expect(body.scoringDefinitionId).toBe('KNOCKOUT_ROUND_POINTS');
  const entry = body.entries.find((candidate) => candidate.entryId === entryId);
  if (!entry) {
    throw new Error(`entry ${entryId} is not on the leaderboard`);
  }
  return { total: entry.totalScore, position: entry.position, picks: entry.picks };
}

function pickOf(read: KnockoutLeaderboardRead, fieldEntryIds: readonly string[], seed: number): KnockoutPickRead {
  const pick = read.picks.find((candidate) => candidate.sportEventParticipantId === fieldEntryIds[seed - 1]);
  if (!pick) {
    throw new Error(`the entry has no pick of the ${seed} seed`);
  }
  return pick;
}

/** Each pick's knockout points, keyed by its team's seed. */
function pointsBySeed(read: KnockoutLeaderboardRead, fieldEntryIds: readonly string[]): Record<number, number | null> {
  return Object.fromEntries(read.picks.map((pick) => [
    fieldEntryIds.indexOf(pick.sportEventParticipantId) + 1,
    pick.knockout?.points ?? null,
  ]));
}

/** Names one match's winner with its button on the bracket tab, which is already open. */
async function recordWinner(page: Page, eventId: string, matchNumber: number, winner: Side) {
  const button = page.getByTestId(`root-admin-bracket-winner-${matchNumber}-${winner}`);
  await expect(button).toBeEnabled();
  await submitAndRead(
    page,
    `root-admin-bracket-winner-${matchNumber}-${winner}`,
    'PUT',
    `/api/v1/events/${eventId}/bracket/matches/${matchNumber}/result`,
  );
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function moveTournamentTo(page: Page, eventId: string, status: 'IN_PROGRESS' | 'COMPLETED') {
  await page.goto(`/manage/sports/basketball/events/${eventId}`);
  await page.getByTestId(`root-admin-sport-event-transition-${status}`).click();
  const moved = await submitAndRead<{ event: { status: string } }>(
    page,
    'root-admin-sport-event-transition-confirm',
    'POST',
    `/api/v1/events/${eventId}/transition`,
  );
  expect(moved.event.status).toBe(status);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

const pad = (value: number) => String(value).padStart(2, '0');

function dateTimeInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
