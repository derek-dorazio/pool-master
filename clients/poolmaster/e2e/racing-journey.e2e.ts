import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  adminSignIn,
  logOut,
  readAdminCredentials,
  type AdminCredentials,
} from './helpers/admin-session';
import { submitAndRead } from './helpers/browser-writes';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { registerFreshUser } from './helpers/user-session';

/**
 * #623 — the horse racing journey (plans/racing-sports.md §9, slice 4): the root admin builds a
 * race on the shared Manage pages (a circuit, eight horses, the race, its field with odds, tiers
 * from those odds, prices) and releases it (act 1); a new commissioner creates a horse racing
 * contest on it with an edited points table (act 2); a new member joins by link and submits an
 * entry, with no tiebreaker to choose (act 3); and the root admin starts the race, loads its
 * official finishing order through the race results card, and completes it, which settles the
 * contest on that points table (act 4).
 *
 * The golden journey's shape and its safety rules, for the same reasons (its header has them in
 * full): a serial file sharing module state between acts, run-unique names, assertions only about
 * what this run created, and teardown of every attempt in `afterAll`. Nothing here is tagged
 * `@smoke`: act 4 writes results and settles a contest, which only the local stack should see.
 */

/** Eight runners, the smallest field horse racing's three default tiers fill (3, 3 and 2). */
const HORSE_COUNT = 8;

/**
 * Odds to win, by horse number (index 0 is horse 1). Ascending, so tiers from odds put horses
 * 1-3 in tier 1, 4-6 in tier 2 and 7-8 in tier 3.
 */
const ODDS_TO_WIN: readonly number[] = [2.5, 3, 4.5, 6, 8, 12, 20, 33];
const TIER_OF_HORSE: readonly number[] = [1, 1, 1, 2, 2, 2, 3, 3];

/** The member's pick in each tier, by horse number: a second favourite, a mid-price, a longshot. */
const PICKED_HORSES: readonly number[] = [2, 4, 8];

/**
 * The commissioner replaces the preset's 5, 3, 1 with this table, so the settled total can only
 * come out right if the edited table, not the preset, reached the contest.
 */
const POINTS_TABLE: readonly number[] = [10, 6, 4, 2];

/**
 * The official result, by horse number: its place, or how its race ended. Horse 4 wins, horse 2
 * is third and horse 8 fourth, so the member's entry scores 10 + 4 + 2 = 16. On the preset's
 * 5, 3, 1 it would have scored 5 + 1 + 0 = 6.
 */
const FINISHING_ORDER: ReadonlyArray<{ horse: number; place: number | null; status: string }> = [
  { horse: 4, place: 1, status: '' },
  { horse: 1, place: 2, status: '' },
  { horse: 2, place: 3, status: '' },
  { horse: 8, place: 4, status: '' },
  { horse: 3, place: 5, status: '' },
  { horse: 5, place: 6, status: '' },
  { horse: 6, place: 7, status: '' },
  { horse: 7, place: null, status: 'DNF' },
];
const EXPECTED_ENTRY_POINTS = 16;

type RacingJourneyState = {
  run: JourneyRun;
  horseIds?: string[];
  raceId?: string;
  /** Field-entry ids by horse number: index 0 is horse 1. */
  fieldEntryIds?: string[];
  leagueId?: string;
  contestId?: string;
  joinUrl?: string;
  entryId?: string;
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

let admin: AdminCredentials | undefined;
let journey: RacingJourneyState | undefined;
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

function requireJourney(): Required<RacingJourneyState> {
  if (!journey) {
    throw new Error('act 1 did not record this attempt; the later acts have nothing to consume');
  }
  return journey as Required<RacingJourneyState>;
}

function horseName(run: JourneyRun, horse: number): string {
  return `${run.playerNamePrefix} ${horse}`;
}

test('act 1: the root admin builds a race — circuit, eight horses, the race, its field with odds, tiers from odds and prices — and releases it', async ({ page }) => {
  test.setTimeout(180_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const run: JourneyRun = {
    runId,
    sport: 'HORSE_RACING',
    tourName: `E2E Circuit ${runId}`,
    playerNamePrefix: `E2E Horse ${runId}`,
    tournamentName: `E2E Stakes ${runId}`,
    commissioner: {
      username: `e2e-rc-${runId}`,
      email: `e2e-rc-${runId}@e2e.invalid`,
      firstName: 'E2E',
      lastName: `Racing Commissioner ${runId}`,
    },
    member: {
      username: `e2e-rm-${runId}`,
      email: `e2e-rm-${runId}@e2e.invalid`,
      firstName: 'E2E',
      lastName: `Racing Member ${runId}`,
    },
    leagueName: `E2E Racing League ${runId}`,
    leagueCode: `E2ER${runId.toUpperCase()}`,
    contestName: `E2E Derby Picks ${runId}`,
    squadName: `E2E Stable ${runId}`,
  };
  runs.push(run);
  journey = { run };
  console.log(`[racing journey ${runId}] race="${run.tournamentName}" league=${run.leagueCode}`);

  await test.step('root admin signs in, and Manage lists horse racing beside golf', async () => {
    await adminSignIn(page, credentials);
    await page.goto('/manage');
    await expect(page.getByTestId('root-admin-manage-menu-horse-racing')).toBeVisible();
    await page.getByTestId('root-admin-manage-menu-horse-racing').click();
    await expect(page).toHaveURL(/\/manage\/sports\/horse-racing\/events$/);
    await expect(page.getByTestId('root-admin-sport-event-list-page')).toBeVisible();
  });

  const circuitId = await test.step('create a racing circuit', async () => {
    await page.goto('/manage/sports/horse-racing/leagues');
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

  const horseIds = await test.step(`create ${HORSE_COUNT} horses`, async () => {
    await page.goto('/manage/sports/horse-racing/participants');
    const ids: string[] = [];
    for (let horse = 1; horse <= HORSE_COUNT; horse += 1) {
      await page.getByTestId('root-admin-participant-list-new').click();
      await page.getByTestId('root-admin-participant-list-new-name').fill(horseName(run, horse));
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
  journey.horseIds = horseIds;

  const raceId = await test.step('create the race on the circuit, a week out', async () => {
    const start = addDays(new Date(), 7);
    start.setHours(17, 0, 0, 0);
    await page.goto('/manage/sports/horse-racing/events/new');
    await page.getByTestId('root-admin-sport-event-create-tour').selectOption(circuitId);
    await page.getByTestId('root-admin-sport-event-create-event-year').fill(String(start.getFullYear()));
    await page.getByTestId('root-admin-sport-event-create-name').fill(run.tournamentName);
    await page.getByTestId('root-admin-sport-event-create-start').fill(dateTimeInput(start));
    // A race is one race: the form starts from the sport's own default.
    await expect(page.getByTestId('root-admin-sport-event-create-rounds')).toHaveValue('1');
    const created = await submitAndRead<{ event: { id: string; sport: string } }>(
      page,
      'root-admin-sport-event-create-submit',
      'POST',
      '/api/v1/events',
    );
    expect(created.event.sport).toBe('HORSE_RACING');
    await expect(page).toHaveURL(new RegExp(`/manage/sports/horse-racing/events/${created.event.id}$`));
    await expect(page.getByTestId('root-admin-sport-event-home-page')).toBeVisible();
    return created.event.id;
  });
  journey.raceId = raceId;

  await test.step(`enter the ${HORSE_COUNT} horses in the field`, async () => {
    await page.goto(`/manage/sports/horse-racing/events/${raceId}/field`);
    await page.getByTestId('root-admin-event-field-add').click();
    await page.getByTestId('root-admin-event-field-add-search').fill(runId);
    for (const id of horseIds) {
      await page.getByTestId(`root-admin-event-field-add-search-select-${id}`).check();
    }
    await submitAndRead(page, 'root-admin-event-field-add-submit', 'POST', `/api/v1/events/${raceId}/participants`);
    await expect(page.getByTestId('root-admin-event-field-add-result')).toBeVisible();
    await page.getByTestId('root-admin-event-field-add-done').click();
  });

  const fieldEntryIds = await test.step('set each horse\'s odds to win in the field grid', async () => {
    // The field read straight from the API, for the field-entry id of each horse (the golden
    // journey's tiers step has the reason it is not sniffed from the page).
    const fieldResponse = await page.request.get(`/api/v1/events/${raceId}/participants`);
    expect(fieldResponse.ok(), `GET the field answered ${fieldResponse.status()}`).toBe(true);
    const field = (await fieldResponse.json()) as { participants: { id: string; participantId: string }[] };
    const entryIds = horseIds.map((horseId) => {
      const entry = field.participants.find((candidate) => candidate.participantId === horseId);
      if (!entry) {
        throw new Error(`horse ${horseId} is not in the field`);
      }
      return entry.id;
    });

    for (const [index, entryId] of entryIds.entries()) {
      await page.getByTestId(`root-admin-event-field-oddsToWin-${entryId}`).fill(String(ODDS_TO_WIN[index]));
    }
    await submitAndRead(page, 'root-admin-event-field-save', 'PATCH', `/api/v1/events/${raceId}/participants`);
    for (const [index, entryId] of entryIds.entries()) {
      await expect(page.getByTestId(`root-admin-event-field-oddsToWin-${entryId}`)).toHaveValue(String(ODDS_TO_WIN[index]));
    }
    return entryIds;
  });
  journey.fieldEntryIds = fieldEntryIds;

  await test.step('tier the field from its odds: the three favourites, the middle three, the two longshots', async () => {
    await page.goto(`/manage/sports/horse-racing/events/${raceId}/tiers`);
    await page.getByTestId('root-admin-tier-auto-odds').click();
    await submitAndRead(page, 'root-admin-tier-auto-tiers-confirm', 'POST', `/api/v1/events/${raceId}/tiers/auto-assign`);
    for (const [index, entryId] of fieldEntryIds.entries()) {
      await expect(
        page
          .getByTestId(`root-admin-tier-column-tier-${TIER_OF_HORSE[index]}`)
          .getByTestId(`root-admin-tier-card-${entryId}`),
      ).toBeVisible();
    }
  });

  await test.step('price the field with the default pricing profile', async () => {
    await page.getByTestId('root-admin-tier-auto-prices').click();
    await expect(page.getByTestId('root-admin-tier-auto-prices-preview')).toBeVisible();
    await submitAndRead(page, 'root-admin-tier-auto-prices-confirm', 'POST', `/api/v1/events/${raceId}/prices/auto-assign`);
    await expect(page.getByTestId('root-admin-tiers-pricing')).toContainText('Priced with');
  });

  await test.step('release the race for contests', async () => {
    await page.goto(`/manage/sports/horse-racing/events/${raceId}`);
    await page.getByTestId('root-admin-sport-event-release').click();
    const released = await submitAndRead<{ event: { status: string } }>(
      page,
      'root-admin-sport-event-release-confirm',
      'POST',
      `/api/v1/events/${raceId}/release`,
    );
    expect(released.event.status).toBe('SCHEDULED');
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

test('act 2: a new commissioner creates a horse racing contest on the race with an edited points table, opens it, and hands out a join link', async ({ page }) => {
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

  await test.step('choose horse racing and the race; the Win / Place / Show preset fills in 5, 3, 1', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
    await expect(page.getByTestId('create-contest-page')).toBeVisible();
    await page.getByTestId('contest-sport-HORSE_RACING').click();
    const raceChoice = page.getByTestId(`contest-event-${state.raceId}`);
    await expect(raceChoice).toContainText(run.tournamentName);
    await raceChoice.click();
    await expect(raceChoice).toBeChecked();
    await expect(page.getByTestId('contest-scoring-points-table')).toHaveValue('5, 3, 1');
    await expect(page.getByTestId('contest-tiered-picks-per-tier')).toHaveValue('1');
  });

  await test.step(`replace the points table with ${POINTS_TABLE.join(', ')}, name the contest, and create it`, async () => {
    await page.getByTestId('contest-scoring-points-table').fill(POINTS_TABLE.join(', '));
    await page.getByTestId('contest-name').fill(run.contestName);
    const created = await submitAndRead<{ contest: { id: string; sport?: string | null } }>(
      page,
      'create-contest-submit',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contests`,
    );
    expect(created.contest.sport).toBe('HORSE_RACING');
    state.contestId = created.contest.id;
    await expect(page.getByTestId('manage-contest-page')).toBeVisible();
    await expect(page.getByTestId('manage-contest-rules')).toContainText('horse');
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

test('act 3: a new member joins by the link and submits one horse from each tier, with no tiebreaker to choose', async ({ page }) => {
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

  await test.step(`pick horses ${PICKED_HORSES.join(', ')}, one from each tier, and submit`, async () => {
    for (const horse of PICKED_HORSES) {
      const fieldEntryId = state.fieldEntryIds[horse - 1];
      await expect(page.getByTestId(`contest-entry-participant-${fieldEntryId}`)).toBeVisible();
      await submitAndRead(page, `contest-entry-participant-${fieldEntryId}`, 'PUT', `/api/v1/selections/${state.contestId}/entries/${state.entryId}/picks/${fieldEntryId}`);
      await expect(page.getByTestId(`contest-entry-selected-${fieldEntryId}`)).toBeVisible();
    }
    await expect(page.getByTestId('contest-entry-tiebreaker-select')).toHaveCount(0);
    await submitAndRead(
      page,
      'contest-entry-submit',
      'POST',
      `/api/v1/selections/${state.contestId}/entries/${state.entryId}/events/${state.raceId}/submit`,
    );
    await expect(page.getByTestId(`contest-board-entry-${state.entryId}`)).toBeVisible();
  });

  await test.step('the member logs out', async () => {
    await logOut(page);
  });
});

test('act 4: the root admin starts the race, loads its official finishing order, and completing it settles the contest on the edited points table', async ({ page }) => {
  test.setTimeout(180_000);
  const state = requireJourney();
  const { run } = state;

  await test.step('root admin signs in and starts the race', async () => {
    await adminSignIn(page, readAdminCredentials());
    await moveRaceTo(page, state.raceId, 'IN_PROGRESS');
  });

  await test.step('the race\'s Results page offers the finishing-order card, not golf round scores', async () => {
    await page.goto(`/manage/sports/horse-racing/events/${state.raceId}/results`);
    await expect(page.getByTestId('root-admin-race-results-panel')).toBeVisible();
    await expect(page.getByTestId('root-admin-sport-event-menu-results')).toHaveText('Results');
    await expect(page.getByTestId('root-admin-race-result-empty')).toBeVisible();
    await expect(page.getByTestId('root-admin-golf-scores-upload-textarea')).toHaveCount(0);
  });

  await test.step('paste the finishing order, mark it official, preview, and apply', async () => {
    await page.getByTestId('root-admin-race-result-mark-official').check();
    const rows = FINISHING_ORDER.map(({ horse, place, status }) =>
      `,${horseName(run, horse)},${place ?? ''},${status},${horse},`);
    await page
      .getByTestId('root-admin-race-result-upload-textarea')
      .fill(['externalId,playerName,finishPosition,resultStatus,startPosition,riderName', ...rows].join('\n'));
    await page.getByTestId('root-admin-race-result-upload-preview').click();
    await expect(page.getByTestId('root-admin-race-result-upload-preview-table')).toBeVisible();
    await expect(page.getByTestId('root-admin-race-result-upload-unresolved')).toHaveCount(0);
    await submitAndRead(page, 'root-admin-race-result-upload-apply', 'PUT', `/api/v1/events/${state.raceId}/race-results`);

    await expect(page.getByTestId('root-admin-race-result-official')).toHaveText('Official');
    const winner = state.fieldEntryIds[FINISHING_ORDER[0].horse - 1];
    const nonFinisher = state.fieldEntryIds[7 - 1];
    await expect(page.getByTestId(`root-admin-race-result-finish-${winner}`)).toHaveText('1st');
    await expect(page.getByTestId(`root-admin-race-result-finish-${nonFinisher}`)).toHaveText('Did not finish');
  });

  await test.step('complete the race, which settles the contest', async () => {
    await moveRaceTo(page, state.raceId, 'COMPLETED');
  });

  await test.step(`the settled entry scores ${EXPECTED_ENTRY_POINTS} on the edited table, and the leaderboard says it is final`, async () => {
    const managed = await page.request.get(
      `/api/v1/leagues/${state.leagueId}/contest-management/contests/${state.contestId}`,
    );
    expect(managed.ok(), `GET the managed contest answered ${managed.status()}`).toBe(true);
    const { contest } = (await managed.json()) as { contest: { status: string } };
    expect(contest.status).toBe('COMPLETED');

    const leaderboard = await page.request.get(`/api/v1/contests/${state.contestId}/leaderboard`);
    expect(leaderboard.ok(), `GET the leaderboard answered ${leaderboard.status()}`).toBe(true);
    const body = (await leaderboard.json()) as {
      entries: Array<{ entryId: string; position: number | null; totalScore: number | null }>;
    };
    const entry = body.entries.find((candidate) => candidate.entryId === state.entryId);
    expect(entry?.totalScore).toBe(EXPECTED_ENTRY_POINTS);
    expect(entry?.position).toBe(1);

    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}/leaderboard`);
    await expect(page.getByTestId('contest-leaderboard-settled-note')).toBeVisible();
    await expect(page.getByTestId(`contest-leaderboard-total-${state.entryId}`)).toContainText(String(EXPECTED_ENTRY_POINTS));
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

async function moveRaceTo(page: Page, raceId: string, status: 'IN_PROGRESS' | 'COMPLETED') {
  await page.goto(`/manage/sports/horse-racing/events/${raceId}`);
  await page.getByTestId(`root-admin-sport-event-transition-${status}`).click();
  const moved = await submitAndRead<{ event: { status: string } }>(
    page,
    'root-admin-sport-event-transition-confirm',
    'POST',
    `/api/v1/events/${raceId}/transition`,
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
