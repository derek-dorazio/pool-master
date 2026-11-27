import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  adminSignIn,
  logOut,
  readAdminCredentials,
  type AdminCredentials,
} from './helpers/admin-session';
import { correctFieldParticipant } from './helpers/event-field';
import { readCsrfToken, submitAndRead } from './helpers/browser-writes';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { createTestEvent, findSeededSportLeague } from './helpers/test-event';
import { addTestParticipants } from './helpers/test-participants';
import { registerFreshUser } from './helpers/user-session';
import { newRunId, e2eName, e2eEmail, e2eUsername, e2eLeagueCode } from './helpers/test-marker';
import { tierSetSlotUrl } from './helpers/tier-set-slot';

/**
 * #623, #2075 — the racing journey, on Formula 1 (a racing league with a feed: a league with none
 * stays off): the root admin builds a race on the shared Manage pages (the seeded series, ten test
 * drivers, the race on its own test slot, its seeded field, tiers from those seeds, prices) and
 * releases it (act 1); a new commissioner creates a tiered racing contest on it with an edited
 * points table (act 2); a new member joins by link and submits an entry, with no tiebreaker to
 * choose (act 3); and the root admin starts the race, loads its official finishing order through
 * the race results card, and completes it, which settles the contest on that points table (act 4).
 *
 * The golden journey's shape and its safety rules, for the same reasons (its header has them in
 * full): a serial file sharing module state between acts, run-unique names, assertions only about
 * what this run created, and teardown of every attempt in `afterAll`. Nothing here is tagged
 * `@smoke`: act 4 writes results and settles a contest, which only the local stack should see.
 */

/** Ten drivers: too few for the series' five tiers of eight, so auto-tiering spreads them two a tier. */
const DRIVER_COUNT = 10;

/**
 * Each driver's seed is their car number, so tiers in seed order put drivers 1-2 in tier 1, 3-4
 * in tier 2, and so on to 9-10 in tier 5. Odds are never typed: they come only from the feed.
 */
const TIER_OF_DRIVER: readonly number[] = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];

/** The member's pick in each tier, by car number. */
const PICKED_DRIVERS: readonly number[] = [2, 4, 5, 8, 10];

/**
 * The commissioner types this table in over whatever the series' setup starts from, so the
 * settled total can only come out right if the typed table reached the contest.
 */
const POINTS_TABLE: readonly number[] = [10, 6, 4, 2];

/**
 * The official result, by car number: its place, or how its race ended. Driver 4 wins, driver 2
 * is third and driver 8 fourth, so the member's entry scores 10 + 4 + 2 = 16. On Formula 1's own
 * 25, 18, 15, 12, ... it would have scored 25 + 15 + 12 + 8 + 2 = 62.
 */
const FINISHING_ORDER: ReadonlyArray<{ driver: number; place: number | null; status: string }> = [
  { driver: 4, place: 1, status: '' },
  { driver: 1, place: 2, status: '' },
  { driver: 2, place: 3, status: '' },
  { driver: 8, place: 4, status: '' },
  { driver: 3, place: 5, status: '' },
  { driver: 5, place: 6, status: '' },
  { driver: 6, place: 7, status: '' },
  { driver: 9, place: 8, status: '' },
  { driver: 10, place: 9, status: '' },
  { driver: 7, place: null, status: 'DNF' },
];
const EXPECTED_ENTRY_POINTS = 16;

type RacingJourneyState = {
  run: JourneyRun;
  driverIds?: string[];
  raceId?: string;
  /** Field-entry ids by car number: index 0 is driver 1. */
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

function driverName(run: JourneyRun, driver: number): string {
  return `${run.playerNamePrefix} ${driver}`;
}

test('act 1: the root admin builds a race — the seeded series, ten test drivers, the race on its own test slot, its seeded field, tiers from seeds and prices — and releases it', async ({ page }) => {
  test.setTimeout(180_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  const runId = newRunId();
  const run: JourneyRun = {
    runId,
    sport: 'AUTO_RACING',
    tourUrlSegment: 'f1',
    playerNamePrefix: e2eName('Driver', runId),
    tournamentName: e2eName('Grand Prix', runId),
    commissioner: {
      username: e2eUsername('rc', runId),
      email: e2eEmail('rc', runId),
      firstName: 'E2E',
      lastName: `Racing Commissioner ${runId}`,
    },
    member: {
      username: e2eUsername('rm', runId),
      email: e2eEmail('rm', runId),
      firstName: 'E2E',
      lastName: `Racing Member ${runId}`,
    },
    leagueName: e2eName('Racing League', runId),
    leagueCode: e2eLeagueCode('R', runId),
    contestName: e2eName('Grid Picks', runId),
    squadName: e2eName('Garage', runId),
  };
  runs.push(run);
  journey = { run };
  console.log(`[racing journey ${runId}] race="${run.tournamentName}" league=${run.leagueCode}`);

  await test.step('root admin signs in, and Manage opens on Sports', async () => {
    await adminSignIn(page, credentials);
    await page.goto('/manage');
    await page.getByTestId('root-admin-manage-menu-sports').click();
    await expect(page.getByTestId('root-admin-sports-table')).toBeVisible();
  });

  const seriesId = await test.step('find the seeded racing series on the Sports page', async () => {
    // A league is added by migration, so a journey plays in a seeded, active one (#2004).
    const { id } = await findSeededSportLeague(page, 'AUTO_RACING', run.tourUrlSegment);
    await page.goto('/manage/sports');
    await expect(page.getByTestId(`root-admin-sports-row-${id}`)).toBeVisible();
    return id;
  });

  const driverIds = await test.step(`create ${DRIVER_COUNT} test drivers`, async () => {
    const names = Array.from({ length: DRIVER_COUNT }, (_, index) => driverName(run, index + 1));
    // Test participants (#2096): the series' real drivers come only from its feed.
    return addTestParticipants(page.request, { 'x-csrf-token': await readCsrfToken(page) }, seriesId, 'INDIVIDUAL', names);
  });
  journey.driverIds = driverIds;

  const raceId = await test.step('create the race on the series, a week out', async () => {
    const start = addDays(new Date(), 7);
    start.setHours(17, 0, 0, 0);
    // A race is one race: the event plays one round in its slot.
    const created = await createTestEvent(page, {
      sportUrlSegment: 'auto-racing',
      sportLeagueId: seriesId,
      slotKind: 'TOURNAMENT',
      slotLabel: run.tournamentName,
      startsAt: start,
      name: run.tournamentName,
    });
    expect(created.sport).toBe('AUTO_RACING');
    await page.goto(`/manage/sports/auto-racing/events/${created.id}`);
    await page.getByTestId('root-admin-event-settings').click();
    await expect(page.getByTestId('root-admin-event-settings-dialog-rounds')).toContainText('1');
    await page.getByTestId('root-admin-event-settings-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    return created.id;
  });
  journey.raceId = raceId;

  await test.step(`enter the ${DRIVER_COUNT} drivers in the field`, async () => {
    await page.goto(`/manage/sports/auto-racing/events/${raceId}/field`);
    await page.getByTestId('root-admin-event-field-add').click();
    await page.getByTestId('root-admin-event-field-add-search').fill(runId);
    for (const id of driverIds) {
      const candidate = page.getByTestId(`root-admin-event-field-add-candidate-${id}`);
      await candidate.click();
      await expect(candidate).toHaveAttribute('aria-pressed', 'true');
    }
    await submitAndRead(page, 'root-admin-event-field-add-modal-apply', 'POST', `/api/v1/events/${raceId}/participants`);
    await expect(page.getByTestId('root-admin-event-field-add-modal')).toBeHidden();
  });

  const fieldEntryIds = await test.step('set each driver\'s seed in its Field dialog', async () => {
    // The field read straight from the API, for the field-entry id of each driver (the golden
    // journey's tiers step has the reason it is not sniffed from the page).
    const fieldResponse = await page.request.get(`/api/v1/events/${raceId}/participants`);
    expect(fieldResponse.ok(), `GET the field answered ${fieldResponse.status()}`).toBe(true);
    const field = (await fieldResponse.json()) as { participants: { id: string; participantId: string }[] };
    const entryIds = driverIds.map((driverId) => {
      const entry = field.participants.find((candidate) => candidate.participantId === driverId);
      if (!entry) {
        throw new Error(`driver ${driverId} is not in the field`);
      }
      return entry.id;
    });

    for (const [index, entryId] of entryIds.entries()) {
      await correctFieldParticipant(page, raceId, entryId, { seedNumber: index + 1 });
    }
    return entryIds;
  });
  journey.fieldEntryIds = fieldEntryIds;

  await test.step('tier the field in seed order, two seeds a tier over the five tiers', async () => {
    await page.getByTestId('root-admin-tier-auto-tiers').click();
    await submitAndRead(page, 'root-admin-tier-auto-tiers-confirm', 'POST', `${await tierSetSlotUrl(page.request, raceId)}/tiers/auto-assign`);
    for (const [index, entryId] of fieldEntryIds.entries()) {
      await expect(page.getByTestId(`root-admin-event-field-row-${entryId}`)).toContainText(`Tier ${String(TIER_OF_DRIVER[index])}`);
    }
  });

  await test.step('price the field with the default pricing profile', async () => {
    await page.getByTestId('root-admin-tier-auto-prices').click();
    await expect(page.getByTestId('root-admin-tier-auto-prices-preview')).toBeVisible();
    await submitAndRead(page, 'root-admin-tier-auto-prices-confirm', 'POST', `${await tierSetSlotUrl(page.request, raceId)}/prices/auto-assign`);
  });

  await test.step('release the race for contests', async () => {
    await page.goto(`/manage/sports/auto-racing/events/${raceId}`);
    await page.getByTestId('root-admin-event-release-chip').click();
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

test('act 2: a new commissioner creates a tiered racing contest on the race with an edited points table, opens it, and hands out a join link', async ({ page }) => {
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

  await test.step('choose auto racing and the race', async () => {
    await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
    await expect(page.getByTestId('create-contest-page')).toBeVisible();
    await page.getByTestId('contest-sport-AUTO_RACING').click();
    const raceChoice = page.getByTestId(`contest-event-${state.raceId}`);
    await expect(raceChoice).toContainText(run.tournamentName);
    await raceChoice.click();
    await expect(raceChoice).toBeChecked();
  });

  await test.step(`choose tiers, one driver a tier, all five count, nothing for not finishing, the points table ${POINTS_TABLE.join(', ')}, name the contest, and create it`, async () => {
    // The series' first contest setup is a budget one; this contest is tiered.
    await page.getByTestId('contest-format-TIERED').click();
    await page.getByTestId('contest-tiered-picks-per-tier').fill('1');
    await page.getByTestId('contest-tiered-counted-scores').fill('5');
    await page.getByTestId('contest-scoring-did-not-finish-points').fill('0');
    await page.getByTestId('contest-scoring-points-table').fill(POINTS_TABLE.join(', '));
    await page.getByTestId('contest-name').fill(run.contestName);
    const created = await submitAndRead<{ contest: { id: string; sport?: string | null } }>(
      page,
      'create-contest-submit',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contests`,
    );
    expect(created.contest.sport).toBe('AUTO_RACING');
    state.contestId = created.contest.id;
    await expect(page.getByTestId('manage-contest-page')).toBeVisible();
    await expect(page.getByTestId('manage-contest-rules')).toContainText('driver');
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

test('act 3: a new member joins by the link and submits one driver from each tier, with no tiebreaker to choose', async ({ page }) => {
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

  await test.step(`pick drivers ${PICKED_DRIVERS.join(', ')}, one from each tier, and submit`, async () => {
    for (const driver of PICKED_DRIVERS) {
      const fieldEntryId = state.fieldEntryIds[driver - 1];
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

test('act 4: the root admin starts the race, its official finishing order comes in, and completing it settles the contest on the edited points table', async ({ page }) => {
  test.setTimeout(180_000);
  const state = requireJourney();
  const { run } = state;

  await test.step('root admin signs in and starts the race', async () => {
    await adminSignIn(page, readAdminCredentials());
    await moveRaceTo(page, state.raceId, 'IN_PROGRESS');
  });

  await test.step('the race\'s Rounds and matches tab shows its result, with no upload and no golf round scores', async () => {
    await page.goto(`/manage/sports/auto-racing/events/${state.raceId}/results`);
    await expect(page.getByTestId('root-admin-race-results-panel')).toBeVisible();
    // The old results link opens the Rounds and matches tab, which holds the results.
    await expect(page.getByTestId('root-admin-event-tab-rounds')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('root-admin-race-result-empty')).toBeVisible();
    // A race's result comes from the feed (#2008): the page offers no paste or upload.
    await expect(page.getByTestId('root-admin-race-result-upload-textarea')).toHaveCount(0);
    await expect(page.getByTestId('root-admin-golf-tournament-scores-page')).toHaveCount(0);
  });

  await test.step('the official finishing order goes in on the test race, by driver id, as the feed would send it', async () => {
    // A test event takes its result through the test-slot result route the test-data loader uses (#2074).
    const response = await page.request.put(`/api/v1/events/${state.raceId}/race-results`, {
      headers: { 'x-csrf-token': await readCsrfToken(page) },
      data: {
        isOfficial: true,
        rows: FINISHING_ORDER.map(({ driver, place, status }) => ({
          participantId: state.driverIds[driver - 1],
          finishPosition: place,
          resultStatus: status === 'DNF' ? 'DID_NOT_FINISH' : 'FINISHED',
          startPosition: driver,
        })),
      },
    });
    expect(response.ok(), `PUT the race result answered ${response.status()}`).toBe(true);

    await page.reload();
    await expect(page.getByTestId('root-admin-race-result-official')).toHaveText('Official');
    const winner = state.fieldEntryIds[FINISHING_ORDER[0].driver - 1];
    const nonFinisher = state.fieldEntryIds[7 - 1];
    await expect(page.getByTestId(`root-admin-race-result-finish-${winner}`)).toHaveText('1st');
    await expect(page.getByTestId(`root-admin-race-result-finish-${nonFinisher}`)).toHaveText('Did not finish');
  });

  await test.step('complete the race, which settles the contest', async () => {
    await moveRaceTo(page, state.raceId, 'COMPLETED');
  });

  await test.step(`the settled entry scores ${EXPECTED_ENTRY_POINTS} on the edited table, and the leaderboard says it is final`, async () => {
    // The contest settles in a background job a moment after the event completes (#1448).
    await expect.poll(async () => {
      const managed = await page.request.get(
        `/api/v1/leagues/${state.leagueId}/contest-management/contests/${state.contestId}`,
      );
      expect(managed.ok(), `GET the managed contest answered ${managed.status()}`).toBe(true);
      const { contest } = (await managed.json()) as { contest: { status: string } };
      return contest.status;
    }, { message: 'the contest settles once the event completes' }).toBe('COMPLETED');

    const leaderboard = await page.request.get(`/api/v1/contests/${state.contestId}/leaderboard`);
    expect(leaderboard.ok(), `GET the leaderboard answered ${leaderboard.status()}`).toBe(true);
    const body = (await leaderboard.json()) as {
      entries: Array<{ entryId: string; position: number | null; totalScore: number | null }>;
    };
    const entry = body.entries.find((candidate) => candidate.entryId === state.entryId);
    expect(entry?.totalScore).toBe(EXPECTED_ENTRY_POINTS);
    expect(entry?.position).toBe(1);

    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    await expect(page.getByTestId('contest-leaderboard-settled-note')).toBeVisible();
    await expect(page.getByTestId(`contest-leaderboard-total-${state.entryId}`)).toContainText(String(EXPECTED_ENTRY_POINTS));
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

async function moveRaceTo(page: Page, raceId: string, status: 'IN_PROGRESS' | 'COMPLETED') {
  await page.goto(`/manage/sports/auto-racing/events/${raceId}`);
  await page.getByTestId('root-admin-event-settings').click();
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

