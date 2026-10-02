import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test';
import {
  adminSignIn,
  logOut,
  readAdminCredentials,
  type AdminCredentials,
} from './helpers/admin-session';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { registerFreshUser } from './helpers/user-session';

/**
 * #84, #280 — the golden journey (plans/130 §"Phase 2 — the journey suite"): the root admin
 * builds a golf catalog (act 1), a brand-new commissioner runs a league and a contest on it
 * (act 2), a brand-new member joins by invite link and enters (act 3), and the root admin scores
 * the event and reads every role's writes back (act 4).
 *
 * Shape: one `test()` per act in a serial file. Tags select tests, not steps (plans/130 §"What
 * act 1 found when it ran"), so acts 1-3, which run post-deploy, sit in a describe tagged
 * `@smoke`, and act 4, which does not, sits outside it — a tag cannot be removed from a test
 * inside a tagged block. Serial mode keeps all four in one worker, in order, so act 1's ids reach
 * the later acts through module state rather than by re-creating the catalog, and a failure skips
 * the acts after it. The HTML report names the failing act in the test title and the failing
 * stage in its steps.
 *
 * Acts 1-3 run against QA as well as the local stack (plans/130 §"Owner ruling"), so the file is
 * safe against a shared, persistent database by construction rather than by refusing to run
 * there:
 *
 * - every name it creates carries a per-attempt run id, so two runs never touch each other's
 *   rows and anything left behind is identifiable;
 * - it reads nothing by identity except the root admin and the golf sport row;
 * - it asserts only the presence of what this run created, never a count or an absence of
 *   anything else, which would pass on an empty local database and fail on QA forever;
 * - teardown removes every attempt's data in `afterAll`, whatever the attempt's outcome.
 *
 * The member joins by invite link, not by email: `POST /leagues/:id/invite-link` returns the code
 * in its body, and QA's SES has no inbox the suite can read.
 */

/** The server's default tier count with one pick each: six golfers fill a six-pick roster. */
const PLAYER_COUNT = 6;

/** What each act hands the next. Filled in as the acts run; a later act asserts what it reads. */
type JourneyState = {
  run: JourneyRun;
  playerIds?: string[];
  eventId?: string;
  /** Field-entry ids in tier order: entry `i` sits alone in `tier-${i + 1}`. */
  fieldEntryIds?: string[];
  commissionerId?: string;
  leagueId?: string;
  contestId?: string;
  joinUrl?: string;
  memberId?: string;
  entryId?: string;
};

// Serial: one worker runs the acts in order and shares this module's state between them. A retry
// re-runs the whole file in a fresh worker, which re-imports the module and so starts clean.
test.describe.configure({ mode: 'serial' });
// An action on a control that never becomes actionable (a missing option, a disabled save)
// fails its own step instead of waiting out the act's timeout.
test.use({ actionTimeout: 20_000 });

let admin: AdminCredentials | undefined;
let journey: JourneyState | undefined;
// Every attempt this worker made, recorded before its first write: each one is torn down,
// success or not, by this worker's `afterAll`.
const runs: JourneyRun[] = [];

test.afterAll(async ({ playwright }, testInfo) => {
  if (!admin || runs.length === 0) {
    return;
  }

  let api: APIRequestContext | undefined;
  try {
    // Built inside the try, so a failure constructing it still reaches the finally.
    api = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    for (const run of runs) {
      try {
        await removeJourneyRun(api, admin, run);
      } catch (error) {
        // Teardown is not the thing under test: report what was left, never fail the test.
        console.error(`[teardown ${run.runId}] aborted, run data may remain:`, error);
      }
    }
  } catch (error) {
    console.error('[teardown] could not start; every attempt of this worker may remain:', error);
  } finally {
    await api?.dispose();
  }
});

function requireJourney(): Required<JourneyState> {
  if (!journey) {
    throw new Error('act 1 did not record this attempt; the later acts have nothing to consume');
  }
  return journey as Required<JourneyState>;
}

test.describe('the member journey, acts 1-3', { tag: '@smoke' }, () => {
  test('act 1: the root admin builds a golf catalog — tour, season, six players, a tournament, its field and tiers', async ({ page }) => {
    test.setTimeout(180_000);
    const credentials = readAdminCredentials();
    admin = credentials;

    // Inside the test body, not at module load: a retry re-imports this module in a new worker
    // and must get its own id rather than collide with its first attempt.
    const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
    const run: JourneyRun = {
      runId,
      tourName: `E2E Tour ${runId}`,
      seasonName: `E2E Season ${runId}`,
      playerNamePrefix: `E2E Golfer ${runId}`,
      tournamentName: `E2E Open ${runId}`,
      // RFC 2606 reserves .invalid, so nothing sent to these can reach a real mailbox.
      commissioner: {
        username: `e2e-c-${runId}`,
        email: `e2e-c-${runId}@e2e.invalid`,
        firstName: 'E2E',
        lastName: `Commissioner ${runId}`,
      },
      member: {
        username: `e2e-m-${runId}`,
        email: `e2e-m-${runId}@e2e.invalid`,
        firstName: 'E2E',
        lastName: `Member ${runId}`,
      },
      leagueName: `E2E League ${runId}`,
      leagueCode: `E2E${runId.toUpperCase()}`,
      contestName: `E2E Pick Six ${runId}`,
      squadName: `E2E Squad ${runId}`,
    };
    // Recorded before anything is created, so a failure on the first write is still torn down.
    runs.push(run);
    journey = { run };
    console.log(
      `[journey ${runId}] tournament="${run.tournamentName}" league=${run.leagueCode} `
      + `users=${run.commissioner.username},${run.member.username}`,
    );

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
    journey.playerIds = playerIds;

    const eventId = await test.step('create a tournament in the season', async () => {
      const now = new Date();
      const start = addDays(now, 7);
      start.setHours(8, 0, 0, 0);
      await page.goto('/manage/golf/tournaments/new');
      await page.getByTestId('root-admin-golf-tournament-create-season').selectOption(seasonId);
      await page.getByTestId('root-admin-golf-tournament-create-name').fill(run.tournamentName);
      await page.getByTestId('root-admin-golf-tournament-create-start').fill(dateTimeInput(start));
      // Released already and locking at the start: act 2 can only create a contest on an event
      // that is released, has a field, and has not locked it (`contestEligible`).
      await page.getByTestId('root-admin-golf-tournament-create-release').fill(dateTimeInput(addDays(now, -1)));
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
    journey.eventId = eventId;

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

    journey.fieldEntryIds = await test.step('place one player in each default tier and save', async () => {
      await page.goto(`/manage/golf/tournaments/${eventId}/tiers`);
      // The board's cards are keyed by field entry, not player, so the act needs that mapping.
      // It reads it straight from the API rather than by sniffing the page's own response.
      //
      // A `waitForResponse` registered before this navigation could match the FIELD page's
      // refetch of the very same path -- both pages read it through `useGolfFieldQuery`, and
      // adding the field invalidates that query. Once `goto` replaced that document Chromium
      // discarded its response bodies, so `.json()` failed with "Protocol error
      // (Network.getResponseBody): No resource with given identifier found". Which response
      // matched came down to latency, so it passed every local run and one QA run before
      // failing the next. `page.request` shares the browser context's cookies, and a GET needs
      // no CSRF header.
      const fieldResponse = await page.request.get(`/api/v1/events/${eventId}/participants`);
      expect(
        fieldResponse.ok(),
        `GET the field answered ${fieldResponse.status()}`,
      ).toBe(true);
      const field = (await fieldResponse.json()) as {
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
      return entryIds;
    });

    await test.step('root admin logs out', async () => {
      await logOut(page);
    });
  });

  test('act 2: a new commissioner creates a league and a contest on the catalog, then hands out a join link', async ({ page }) => {
    test.setTimeout(120_000);
    const state = requireJourney();
    const { run } = state;

    await test.step('a fresh commissioner registers', async () => {
      await page.goto('/');
      await page.getByTestId('auth-mode-register').click();
      state.commissionerId = await registerFreshUser(page, run.commissioner);
      await expect(page.getByTestId('authenticated-landing')).toBeVisible();
    });

    await test.step('create a league from the welcome page', async () => {
      await page.getByTestId('welcome-create-league').click();
      // Code before name: leaving the name field suggests a code from it, and that suggestion
      // lands after a fill that moved focus away. Typing the code first marks it user-edited,
      // so no suggestion ever replaces it.
      await page.getByTestId('create-league-code').fill(run.leagueCode);
      await page.getByTestId('create-league-name').fill(run.leagueName);
      await page.getByTestId('create-league-description').fill(`Golden journey run ${run.runId}`);
      await page.getByTestId('create-league-next').click();
      const created = await submitAndRead<{ league: { id: string; leagueCode: string } }>(
        page,
        'create-league-submit',
        'POST',
        '/api/v1/leagues',
      );
      expect(created.league.leagueCode).toBe(run.leagueCode);
      state.leagueId = created.league.id;
      await expect(page.getByTestId('league-home')).toBeVisible();
      await expect(page.getByTestId('league-summary-name')).toHaveText(run.leagueName);
    });

    await test.step('create a contest on act 1\'s tournament: roster 6, counted 4, one entry per team', async () => {
      await page.goto(`/league/${run.leagueCode}/contests/new`);
      await expect(page.getByTestId('create-contest-page')).toBeVisible();
      // The picker lists every contest-eligible golf event on the platform, QA's whole catalog
      // included, so the run's own tournament is chosen by its id and checked by its name.
      const picker = page.getByTestId('contest-sport-event');
      await expect(picker.locator(`option[value="${state.eventId}"]`)).toContainText(run.tournamentName);
      await picker.selectOption(state.eventId);
      await page.getByTestId('contest-name').fill(run.contestName);
      await page.getByTestId('contest-max-entries-unlimited').uncheck();
      await page.getByTestId('contest-max-entries').fill('1');
      await page.getByTestId('contest-tiered-roster-size').fill('6');
      await page.getByTestId('contest-tiered-counted-scores').fill('4');
      const created = await submitAndRead<{ contest: { id: string; name: string } }>(
        page,
        'create-contest-submit',
        'POST',
        `/api/v1/leagues/${state.leagueId}/contests`,
      );
      expect(created.contest.name).toBe(run.contestName);
      state.contestId = created.contest.id;
      await expect(page).toHaveURL(new RegExp(`/league/${run.leagueCode}/contests/${state.contestId}$`));
    });

    await test.step('the contest is on the board with no entries, and on the league\'s contest list', async () => {
      await expect(page.getByTestId('contest-board')).toBeVisible();
      await expect(page.getByTestId('contest-detail-heading')).toHaveText(run.contestName);
      // The contest is this run's own and seconds old: zero entries is a fact about it, not
      // about anything else in the database.
      await expect(page.getByTestId('contest-board-total-count')).toHaveText(/\b0$/);
      await page.goto(`/league/${run.leagueCode}/contests`);
      await expect(page.getByTestId('league-contests-page')).toBeVisible();
      await expect(page.getByTestId(`league-contest-${state.contestId}`)).toContainText(run.contestName);
    });

    await test.step('edit the league description', async () => {
      const description = `Edited by the commissioner, run ${run.runId}`;
      await page.goto(`/league/${run.leagueCode}`);
      await page.getByTestId('league-open-details').click();
      await page.getByTestId('league-details-description').fill(description);
      const saved = await submitAndRead<{ league: { description: string | null } }>(
        page,
        'league-save-details',
        'PUT',
        `/api/v1/leagues/${state.leagueId}/details`,
      );
      expect(saved.league.description).toBe(description);
      await expect(page.getByTestId('league-summary-description')).toHaveText(description);
    });

    await test.step('generate the join URL', async () => {
      await page.getByTestId('league-open-invite-members').click();
      const created = await submitAndRead<{ invitation: { inviteCode: string } }>(
        page,
        'league-create-join-url',
        'POST',
        `/api/v1/leagues/${state.leagueId}/invite-link`,
      );
      const joinUrl = page.getByTestId('league-join-url');
      await expect(joinUrl).toHaveValue(new RegExp(`/invite/${created.invitation.inviteCode}$`));
      // The hand-off to act 3: the string a commissioner would copy and send.
      state.joinUrl = await joinUrl.inputValue();
      await page.keyboard.press('Escape');
    });

    await test.step('the commissioner logs out', async () => {
      await logOut(page);
    });
  });

  test('act 3: a new member joins by the link, builds a six-tier entry and submits it', async ({ page }) => {
    test.setTimeout(120_000);
    const state = requireJourney();
    const { run } = state;

    await test.step('open the join URL signed out and register through the invite', async () => {
      await page.goto(state.joinUrl);
      // Signed out, the invite page offers only sign-in or registration; registration carries
      // the invite path through and returns to it.
      await page.getByTestId('invite-create-account').click();
      state.memberId = await registerFreshUser(page, run.member);
      await expect(page.getByTestId('join-league-page')).toBeVisible();
    });

    await test.step('name the squad, pick an icon, and accept', async () => {
      await page.getByTestId('join-league-team-name').fill(run.squadName);
      await page.getByTestId('join-league-team-icon-CAPTAIN_SMILE_OCEAN').click();
      await page.getByTestId('invite-accept').click();
      await expect(page.getByTestId('league-home')).toBeVisible();
      await expect(page.getByTestId('league-summary-name')).toHaveText(run.leagueName);
      // The squad the acceptance created and renamed, read back as the member sees it.
      const squads = await page.request.get(`/api/v1/leagues/${state.leagueId}/squads/`);
      expect(squads.ok(), `GET the league's squads answered ${squads.status()}`).toBe(true);
      const { squads: list } = (await squads.json()) as {
        squads: { name: string; iconKey: string; members?: { userId: string }[] }[];
      };
      const mine = list.find((squad) => squad.members?.some((member) => member.userId === state.memberId));
      expect(mine?.name).toBe(run.squadName);
      expect(mine?.iconKey).toBe('CAPTAIN_SMILE_OCEAN');
    });

    await test.step('open the contest and create an entry', async () => {
      await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
      await expect(page.getByTestId('contest-board')).toBeVisible();
      const created = await submitAndRead<{ entry: { id: string } }>(
        page,
        'contest-board-create-entry',
        'POST',
        `/api/v1/contests/${state.contestId}/entries/me`,
      );
      state.entryId = created.entry.id;
      await expect(page.getByTestId('contest-entry-builder-heading')).toBeVisible();
    });

    await test.step('pick one golfer from each of the six tiers, set the tiebreaker, submit', async () => {
      for (const fieldEntryId of state.fieldEntryIds) {
        // The builder opens the first incomplete tier and advances to the next one after each
        // saved pick, so each golfer appears on its own. Toggling a tier by hand would race that
        // advance and could close the very tier it just opened.
        await expect(page.getByTestId(`contest-entry-participant-${fieldEntryId}`)).toBeVisible();
        await submitAndRead(
          page,
          `contest-entry-participant-${fieldEntryId}`,
          'POST',
          `/api/v1/drafts/${state.contestId}/pick`,
        );
        await expect(page.getByTestId(`contest-entry-selected-${fieldEntryId}`)).toBeVisible();
      }
      // Any offered value: the tiebreaker is required, its value is not under test.
      await page.getByTestId('contest-entry-tiebreaker-select').selectOption({ index: 1 });
      await submitAndRead(
        page,
        'contest-entry-submit',
        'PATCH',
        `/api/v1/contests/${state.contestId}/entries/${state.entryId}`,
      );
    });

    await test.step('the entry is on the board as the member\'s own', async () => {
      await expect(page.getByTestId('contest-board')).toBeVisible();
      await expect(page.getByTestId(`contest-board-entry-${state.entryId}`)).toBeVisible();
      await expect(page.getByTestId(`contest-board-entry-spotlight-${state.entryId}`)).toBeVisible();
      await expect(page.getByTestId('contest-board-my-count')).toHaveText(/\b1$/);
    });

    await test.step('the entry page shows its six picks', async () => {
      await page.getByTestId(`contest-board-edit-entry-${state.entryId}`).click();
      await expect(page.getByTestId('contest-entry-builder-heading')).toBeVisible();
      for (const fieldEntryId of state.fieldEntryIds) {
        await expect(page.getByTestId(`contest-entry-selected-${fieldEntryId}`)).toBeVisible();
      }
    });

    await test.step('rename the entry inline on the board', async () => {
      const name = `E2E Entry ${run.runId}`;
      await page.getByTestId('contest-entry-back-to-contest').click();
      await page.getByTestId(`contest-board-rename-${state.entryId}`).click();
      await page.getByTestId(`contest-board-rename-input-${state.entryId}`).fill(name);
      const renamed = await submitAndRead<{ entry: { name: string } }>(
        page,
        `contest-board-rename-save-${state.entryId}`,
        'PATCH',
        `/api/v1/contests/${state.contestId}/entries/${state.entryId}`,
      );
      expect(renamed.entry.name).toBe(name);
      await expect(page.getByTestId(`contest-board-entry-${state.entryId}`)).toContainText(name);
    });

    await test.step('change a preference on the account page', async () => {
      await page.goto('/my-account');
      await expect(page.getByTestId('user-page')).toBeVisible();
      await page.getByTestId('user-page-open-preferences').click();
      await page.getByTestId('user-page-date-format').selectOption('YMD');
      await submitAndRead(page, 'user-page-save-preferences', 'PUT', '/api/v1/users/me/preferences');
    });

    await test.step('open the league history page', async () => {
      await page.goto(`/league/${run.leagueCode}/history`);
      await expect(page.getByTestId('my-team-history-page')).toBeVisible();
      await expect(page.getByTestId('shared-error-state')).toHaveCount(0);
      await expect(page.getByTestId('shared-forbidden-state')).toHaveCount(0);
    });

    await test.step('the member logs out', async () => {
      await logOut(page);
    });
  });
});

// Act 4 is deliberately OUTSIDE the tagged describe: untagged, so it runs pre-merge only. It
// writes round scores and moves the event to IN_PROGRESS — the least reversible step in the
// journey, and one that activates the contest and mails its members. Whether it should also run
// post-deploy is the owner's call (#280), not this file's.
test('act 4: the root admin scores round 1, starts the event, and reads every role\'s writes back', async ({ page }) => {
  test.setTimeout(120_000);
  const state = requireJourney();
  const { run } = state;
  const credentials = readAdminCredentials();

  await test.step('root admin signs in', async () => {
    await adminSignIn(page, credentials);
  });

  await test.step('enter round-1 scores for the six players', async () => {
    await page.goto(`/manage/golf/tournaments/${state.eventId}/scores`);
    await expect(page.getByTestId('root-admin-golf-tournament-scores-page')).toBeVisible();
    const rows = Array.from(
      { length: PLAYER_COUNT },
      (_, index) => `,${run.playerNamePrefix} ${index + 1},${70 + index},${index - 2},18,COMPLETED`,
    );
    await page
      .getByTestId('root-admin-golf-scores-upload-textarea')
      .fill(['externalId,playerName,strokes,scoreToPar,thru,status', ...rows].join('\n'));
    await page.getByTestId('root-admin-golf-scores-upload-preview').click();
    await expect(page.getByTestId('root-admin-golf-scores-upload-preview-result')).toBeVisible();
    await submitAndRead(
      page,
      'root-admin-golf-scores-upload-apply',
      'POST',
      `/api/v1/events/${state.eventId}/rounds/1/golf-scores`,
    );
    for (const fieldEntryId of state.fieldEntryIds) {
      await expect(page.getByTestId(`root-admin-golf-scores-strokes-${fieldEntryId}`)).toBeVisible();
    }
  });

  await test.step('move the tournament to in progress', async () => {
    await page.goto(`/manage/golf/tournaments/${state.eventId}`);
    await page.getByTestId('root-admin-golf-tournament-transition-IN_PROGRESS').click();
    const moved = await submitAndRead<{ event: { status: string } }>(
      page,
      'root-admin-golf-tournament-transition-confirm',
      'POST',
      `/api/v1/events/${state.eventId}/transition`,
    );
    expect(moved.event.status).toBe('IN_PROGRESS');
  });

  await test.step('the member\'s picks are revealed on the board and the leaderboard carries a score', async () => {
    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    await page.getByTestId(`contest-board-toggle-${state.entryId}`).click();
    for (const playerId of state.playerIds) {
      await expect(
        page.getByTestId(`contest-leaderboard-participant-${state.entryId}-${playerId}`),
      ).toBeVisible();
    }
    // The web app renders no score on the board yet; the golf leaderboard endpoint is where a
    // scored pick first appears. Presence only — no arithmetic.
    const leaderboard = await page.request.get(`/api/v1/contests/${state.contestId}/golf/leaderboard`);
    expect(leaderboard.ok(), `GET the leaderboard answered ${leaderboard.status()}`).toBe(true);
    const { participants } = (await leaderboard.json()) as {
      participants: { id: string; rounds?: { roundNumber: number; golf?: { strokes: number } | null }[] }[];
    };
    const scored = participants.filter(
      (participant) =>
        state.fieldEntryIds.includes(participant.id)
        && participant.rounds?.some((round) => round.roundNumber === 1 && round.golf != null),
    );
    expect(scored.map((participant) => participant.id).sort()).toEqual([...state.fieldEntryIds].sort());
  });

  await test.step('the new league and both new users are visible to the root admin', async () => {
    await expectListPageLoaded(page, '/manage/leagues', 'root-admin-manage-leagues-page', 'root-admin-manage-leagues-table');
    await expect(page.getByTestId(`root-admin-manage-leagues-link-${state.leagueId}`)).toBeVisible();
    await expectListPageLoaded(page, '/manage/users', 'root-admin-manage-users-page', 'root-admin-manage-users-table');
    await expect(page.getByTestId(`root-admin-manage-user-row-${state.commissionerId}`)).toBeVisible();
    await expect(page.getByTestId(`root-admin-manage-user-row-${state.memberId}`)).toBeVisible();
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

/**
 * Clicks a submit and returns the body of the write it sent, failing on a non-2xx.
 *
 * Safe only for a submit whose follow-up routing is client-side. A `waitForResponse` handle does
 * not survive a document navigation: once one lands, Chromium has discarded the body and
 * `.json()` fails (see act 1's tiers step). Every submit this file passes here routes through the
 * SPA router; a submit that triggers a real navigation must read server state with
 * `page.request` instead.
 */
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
