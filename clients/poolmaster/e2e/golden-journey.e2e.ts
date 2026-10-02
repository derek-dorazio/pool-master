import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test';
import { adminApiHeaders, attempt, expectOk, type AuthHeaders, type Log } from './helpers/admin-api';
import {
  adminSignIn,
  logOut,
  readAdminCredentials,
  type AdminCredentials,
} from './helpers/admin-session';

/**
 * #84 — the golden journey (plans/130 §"Phase 2 — the journey suite"). This slice writes act 1,
 * the root admin building a golf catalog; #280 adds the acts that consume it. The act is one
 * `test()` with a `test.step()` per stage, so the HTML report names the act in the test title
 * and the failing stage in its steps.
 *
 * Act 1 is tagged `@smoke` and runs post-deploy against QA as well as pre-merge against the
 * local stack (plans/130 §"Owner ruling"). So it is safe against a shared, persistent database
 * by construction rather than by refusing to run there:
 *
 * - every name it creates carries a per-attempt run id, so two runs never touch each other's
 *   rows and anything left behind is identifiable;
 * - it reads nothing by identity except the root admin and the golf sport row;
 * - it asserts only the presence of what this run created, never a count or an absence of
 *   anything else, which would pass on an empty local database and fail on QA forever;
 * - teardown removes every attempt's data in `afterAll`, whatever the attempt's outcome.
 */

/** The server's default tier count with one pick each: six golfers fill a six-pick roster. */
const PLAYER_COUNT = 6;

type CatalogRun = {
  runId: string;
  tourName: string;
  seasonName: string;
  playerNamePrefix: string;
  tournamentName: string;
};

// An action on a control that never becomes actionable (a missing option, a disabled save)
// fails its own step instead of waiting out the whole journey's timeout.
test.use({ actionTimeout: 20_000 });

let admin: AdminCredentials | undefined;
// Every attempt this worker made, not just the last: each one is torn down, success or not.
const runs: CatalogRun[] = [];

test.afterAll(async ({ playwright }, testInfo) => {
  if (!admin || runs.length === 0) {
    return;
  }

  let api: APIRequestContext | undefined;
  try {
    api = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    for (const run of runs) {
      try {
        await removeCatalogRun(api, admin, run);
      } catch (error) {
        // Teardown is not the thing under test: report what was left, never fail the test.
        console.error(`[teardown ${run.runId}] aborted, run data may remain:`, error);
      }
    }
  } finally {
    await api?.dispose();
  }
});

test('act 1: the root admin builds a golf catalog — tour, season, six players, a tournament, its field and tiers', { tag: '@smoke' }, async ({ page }) => {
  test.setTimeout(180_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  // Inside the test body, not at module load: a retry re-imports this module in a new worker
  // and must get its own id rather than collide with its first attempt.
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const run: CatalogRun = {
    runId,
    tourName: `E2E Tour ${runId}`,
    seasonName: `E2E Season ${runId}`,
    playerNamePrefix: `E2E Golfer ${runId}`,
    tournamentName: `E2E Open ${runId}`,
  };
  // Recorded before anything is created, so a failure on the first write is still torn down.
  runs.push(run);
  console.log(`[journey ${runId}] tour="${run.tourName}" tournament="${run.tournamentName}"`);

  await test.step('root admin signs in', async () => {
    await adminSignIn(page, credentials);
  });

  await test.step('the manage pages load without an error state', async () => {
    await expect(page.getByTestId('account-menu-trigger')).toBeVisible();
    await page.goto('/manage');
    await expect(page.getByTestId('root-admin-manage-hub-page')).toBeVisible();
    await expectListPageLoaded(page, '/manage/events', 'root-admin-events-page', 'root-admin-events-table');
    await expectListPageLoaded(page, '/manage/leagues', 'root-admin-manage-leagues-page', 'root-admin-manage-leagues-table');
    await expectListPageLoaded(page, '/manage/users', 'root-admin-manage-users-page', 'root-admin-manage-users-table');
    await expectListPageLoaded(page, '/manage/golf/tournaments', 'root-admin-golf-tournament-list-page', 'root-admin-golf-tournament-list-table');
    await expectListPageLoaded(page, '/manage/golf/players', 'root-admin-golf-player-list-page', 'root-admin-golf-player-list-table');
  });

  const tourId = await test.step('create a golf tour', async () => {
    await page.goto('/manage/golf/leagues');
    await page.getByTestId('root-admin-golf-league-list-new').click();
    await page.getByTestId('root-admin-golf-league-list-new-name').fill(run.tourName);
    const created = await submitAndRead<{ sportLeague: { id: string } }>(
      page,
      'root-admin-golf-league-list-new-save',
      'POST',
      '/api/v1/sport-leagues',
    );
    const id = created.sportLeague.id;
    await expect(page.getByTestId(`root-admin-golf-league-row-${id}`)).toBeVisible();
    return id;
  });

  const seasonId = await test.step('create a season under the tour', async () => {
    const today = new Date();
    await page.goto(`/manage/golf/seasons?sportLeagueId=${tourId}`);
    await page.getByTestId('root-admin-golf-season-list-new').click();
    await page.getByTestId('root-admin-golf-season-list-new-tour').selectOption(tourId);
    await page.getByTestId('root-admin-golf-season-list-new-name').fill(run.seasonName);
    await page.getByTestId('root-admin-golf-season-list-new-year').fill(String(today.getFullYear()));
    // Spans the tournament created below, a week out.
    await page.getByTestId('root-admin-golf-season-list-new-start').fill(dateInput(addDays(today, -30)));
    await page.getByTestId('root-admin-golf-season-list-new-end').fill(dateInput(addDays(today, 335)));
    const created = await submitAndRead<{ season: { id: string } }>(
      page,
      'root-admin-golf-season-list-new-save',
      'POST',
      `/api/v1/sport-leagues/${tourId}/seasons`,
    );
    const id = created.season.id;
    await expect(page.getByTestId(`root-admin-golf-season-row-${id}`)).toBeVisible();
    return id;
  });

  const playerIds = await test.step(`create ${PLAYER_COUNT} players`, async () => {
    await page.goto('/manage/golf/players');
    const ids: string[] = [];
    for (let index = 1; index <= PLAYER_COUNT; index += 1) {
      await page.getByTestId('root-admin-golf-player-list-new').click();
      await page.getByTestId('root-admin-golf-player-list-new-name').fill(`${run.playerNamePrefix} ${index}`);
      const created = await submitAndRead<{ participant: { id: string } }>(
        page,
        'root-admin-golf-player-list-new-save',
        'POST',
        '/api/v1/participants',
      );
      ids.push(created.participant.id);
    }
    for (const id of ids) {
      await expect(page.getByTestId(`root-admin-golf-player-row-${id}`)).toBeVisible();
    }
    return ids;
  });

  const eventId = await test.step('create a tournament in the season', async () => {
    const start = addDays(new Date(), 7);
    start.setHours(8, 0, 0, 0);
    await page.goto('/manage/golf/tournaments/new');
    await page.getByTestId('root-admin-golf-tournament-create-season').selectOption(seasonId);
    await page.getByTestId('root-admin-golf-tournament-create-name').fill(run.tournamentName);
    await page.getByTestId('root-admin-golf-tournament-create-start').fill(dateTimeInput(start));
    await page.getByTestId('root-admin-golf-tournament-create-release').fill(dateTimeInput(addDays(start, -6)));
    await page.getByTestId('root-admin-golf-tournament-create-locks').fill(dateTimeInput(start));
    await page.getByTestId('root-admin-golf-tournament-create-rounds').fill('4');
    const created = await submitAndRead<{ event: { id: string } }>(
      page,
      'root-admin-golf-tournament-create-submit',
      'POST',
      '/api/v1/events',
    );
    const id = created.event.id;
    await expect(page).toHaveURL(new RegExp(`/manage/golf/tournaments/${id}$`));
    await expect(page.getByTestId('root-admin-golf-tournament-home-page')).toBeVisible();
    return id;
  });

  await test.step(`load the ${PLAYER_COUNT} players into the field in one submit`, async () => {
    await page.goto(`/manage/golf/tournaments/${eventId}/field`);
    await page.getByTestId('root-admin-golf-field-add').click();
    await expect(page.getByTestId('root-admin-golf-field-add-modal')).toBeVisible();
    // The free-text search spans every participant, so the players need no tour roster.
    await page.getByTestId('root-admin-golf-field-add-search').fill(runId);
    for (const id of playerIds) {
      await page.getByTestId(`root-admin-golf-field-add-search-select-${id}`).check();
    }
    await submitAndRead(
      page,
      'root-admin-golf-field-add-submit',
      'POST',
      `/api/v1/events/${eventId}/participants`,
    );
    await expect(page.getByTestId('root-admin-golf-field-add-result')).toBeVisible();
    await page.getByTestId('root-admin-golf-field-add-done').click();
  });

  await test.step('place one player in each default tier and save', async () => {
    // The board's cards are keyed by field entry, not player: read the mapping from the
    // field the page itself loads.
    const fieldLoaded = page.waitForResponse((response) =>
      isCall(response, 'GET', `/api/v1/events/${eventId}/participants`),
    );
    await page.goto(`/manage/golf/tournaments/${eventId}/tiers`);
    const field = (await (await fieldLoaded).json()) as {
      participants: { id: string; participantId: string }[];
    };
    const entryIds = playerIds.map((playerId) => {
      const entry = field.participants.find((candidate) => candidate.participantId === playerId);
      if (!entry) {
        throw new Error(`player ${playerId} is not in the field the tiers page loaded`);
      }
      return entry.id;
    });

    const unassigned = page.getByTestId('root-admin-golf-tier-column-__unassigned');
    for (const [index, entryId] of entryIds.entries()) {
      // A freshly added golfer starts unassigned; the move control is a select of tiers.
      await expect(unassigned.getByTestId(`root-admin-golf-tier-card-${entryId}`)).toBeVisible();
      await page.getByTestId(`root-admin-golf-tier-move-${entryId}`).selectOption(`tier-${index + 1}`);
    }
    await submitAndRead(
      page,
      'root-admin-golf-tier-board-save',
      'PUT',
      `/api/v1/events/${eventId}/tiers/assignments`,
    );
    for (const [index, entryId] of entryIds.entries()) {
      await expect(
        page
          .getByTestId(`root-admin-golf-tier-column-tier-${index + 1}`)
          .getByTestId(`root-admin-golf-tier-card-${entryId}`),
      ).toBeVisible();
    }
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

async function expectListPageLoaded(page: Page, path: string, landmark: string, table: string) {
  await page.goto(path);
  await expect(page.getByTestId(landmark)).toBeVisible();
  // The table renders only once the page's query has settled without an error, so the
  // absence check below cannot pass merely because the page is still loading.
  await expect(page.getByTestId(table)).toBeVisible();
  await expect(page.getByTestId('shared-error-state')).toHaveCount(0);
  await expect(page.getByTestId('shared-forbidden-state')).toHaveCount(0);
}

// The generated SDK sends collection routes with a trailing slash (`/api/v1/events/`), so
// paths compare without one.
const trimSlash = (path: string) => path.replace(/\/+$/, '');

function isCall(response: Response, method: string, path: string): boolean {
  return (
    response.request().method() === method &&
    trimSlash(new URL(response.url()).pathname) === trimSlash(path)
  );
}

// A write that never answers fails its own step quickly instead of at the test timeout.
const WRITE_TIMEOUT_MS = 20_000;

/** Clicks a submit and returns the body of the write it sent, failing on a non-2xx. */
async function submitAndRead<T = unknown>(page: Page, submitTestId: string, method: string, path: string): Promise<T> {
  const responded = page.waitForResponse((response) => isCall(response, method, path), {
    timeout: WRITE_TIMEOUT_MS,
  });
  await page.getByTestId(submitTestId).click();
  const response = await responded;
  expect(response.ok(), `${method} ${path} answered ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

const pad = (value: number) => String(value).padStart(2, '0');

function dateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateTimeInput(date: Date): string {
  return `${dateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// --- Teardown -------------------------------------------------------------------------------
//
// Every lookup is by this run's run-unique names rather than ids captured during the test, so an
// attempt that failed between a write and reading its response is still found and removed.

async function removeCatalogRun(
  api: APIRequestContext,
  credentials: AdminCredentials,
  run: CatalogRun,
): Promise<void> {
  const log: Log = (message) => console.log(`[teardown ${run.runId}] ${message}`);
  const headers = await adminApiHeaders(api, credentials);
  if (!headers) {
    log(`admin login failed; could not remove tour "${run.tourName}", its season and tournament, or the players`);
    return;
  }

  // The event first: it holds the field, rounds and tiers, and it belongs to the season.
  await attempt(log, `tournament "${run.tournamentName}"`, () => removeTournament(api, headers, run, log));
  const tourId = await findTourId(api, headers, run);
  if (tourId) {
    await attempt(log, `season "${run.seasonName}"`, () => inactivateSeason(api, headers, tourId, run, log));
    await attempt(log, `tour "${run.tourName}"`, () => inactivateTour(api, headers, tourId, run, log));
  } else {
    log(`tour "${run.tourName}" was never created; no tour or season to remove`);
  }
  await attempt(log, `players "${run.playerNamePrefix} *"`, () => inactivatePlayers(api, headers, run, log));
}

async function removeTournament(api: APIRequestContext, headers: AuthHeaders, run: CatalogRun, log: Log) {
  const list = await expectOk(
    api.get('/api/v1/events', { headers, params: { q: run.tournamentName } }),
    'list tournaments',
  );
  const { events } = (await list.json()) as { events: { id: string; name: string }[] };
  const event = events.find((candidate) => candidate.name === run.tournamentName);
  if (!event) {
    log(`tournament "${run.tournamentName}" was never created; nothing to remove`);
    return;
  }
  await expectOk(api.delete(`/api/v1/events/${event.id}`, { headers }), 'delete tournament');
  const reread = await api.get(`/api/v1/events/${event.id}`, { headers });
  log(reread.status() === 404
    ? `tournament "${run.tournamentName}" removed with its field, rounds and tiers (re-read 404)`
    : `tournament "${run.tournamentName}" STILL PRESENT after delete (re-read ${reread.status()})`);
}

async function findTourId(api: APIRequestContext, headers: AuthHeaders, run: CatalogRun): Promise<string | null> {
  const list = await expectOk(
    api.get('/api/v1/sport-leagues', { headers, params: { sport: 'GOLF' } }),
    'list tours',
  );
  const { sportLeagues } = (await list.json()) as { sportLeagues: { id: string; name: string }[] };
  return sportLeagues.find((candidate) => candidate.name === run.tourName)?.id ?? null;
}

// Tours and seasons have no delete operation, so they are inactivated: out of every active
// picker, and identifiable by run id for plans/129's QA reset.
async function inactivateSeason(
  api: APIRequestContext,
  headers: AuthHeaders,
  tourId: string,
  run: CatalogRun,
  log: Log,
) {
  const list = await expectOk(api.get(`/api/v1/sport-leagues/${tourId}/seasons`, { headers }), 'list seasons');
  const { seasons } = (await list.json()) as { seasons: { id: string; name: string }[] };
  const season = seasons.find((candidate) => candidate.name === run.seasonName);
  if (!season) {
    log(`season "${run.seasonName}" was never created; nothing to remove`);
    return;
  }
  await expectOk(
    api.patch(`/api/v1/seasons/${season.id}`, { headers, data: { isActive: false } }),
    'inactivate season',
  );
  log(`season "${run.seasonName}" inactivated (no delete operation exists)`);
}

async function inactivateTour(
  api: APIRequestContext,
  headers: AuthHeaders,
  tourId: string,
  run: CatalogRun,
  log: Log,
) {
  await expectOk(
    api.patch(`/api/v1/sport-leagues/${tourId}`, { headers, data: { isActive: false } }),
    'inactivate tour',
  );
  log(`tour "${run.tourName}" inactivated (no delete operation exists)`);
}

// Participants have no delete operation either; an inactive player drops out of the active
// roster and the field search.
async function inactivatePlayers(api: APIRequestContext, headers: AuthHeaders, run: CatalogRun, log: Log) {
  const list = await expectOk(
    api.get('/api/v1/participants', { headers, params: { q: run.playerNamePrefix, status: 'ACTIVE' } }),
    'search players',
  );
  const { participants } = (await list.json()) as { participants: { id: string; name: string }[] };
  const players = participants.filter((candidate) => candidate.name.startsWith(`${run.playerNamePrefix} `));
  if (players.length === 0) {
    log(`no active players named "${run.playerNamePrefix} *"; nothing to inactivate`);
    return;
  }
  for (const player of players) {
    await attempt(log, `player "${player.name}"`, async () => {
      await expectOk(
        api.patch(`/api/v1/participants/${player.id}`, { headers, data: { status: 'INACTIVE' } }),
        `inactivate player ${player.name}`,
      );
      log(`player "${player.name}" inactivated (no delete operation exists)`);
    });
  }
}
