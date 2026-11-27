import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  adminSignIn,
  logOut,
  readAdminCredentials,
  type AdminCredentials,
} from './helpers/admin-session';
import { closeFieldParticipant, correctFieldParticipant, openFieldParticipant } from './helpers/event-field';
import { readCsrfToken, submitAndRead } from './helpers/browser-writes';
import { addTestParticipants } from './helpers/test-participants';
import { removeJourneyRun, type JourneyRun } from './helpers/journey-teardown';
import { createTestEvent, findSeededSportLeague } from './helpers/test-event';
import { generatePassword, registerFreshUser } from './helpers/user-session';
import { newRunId, e2eName, e2eEmail, e2eUsername, e2eLeagueCode } from './helpers/test-marker';

/**
 * #84, #280 — the golden journey (plans/130 §"Phase 2 — the journey suite", deleted:
 * `git show 392c725:plans/130-e2e-browser-suite-evaluation.md`): the root admin
 * builds a golf catalog (act 1), a brand-new commissioner runs a league and a contest on it
 * (act 2), a brand-new member joins by invite link and enters (act 3), the root admin scores the
 * event and reads every role's writes back (act 4), further rounds of scores move the contest
 * leaderboard (act 5, #326), and completing the event settles the contest (act 6). Acts 4-6 also
 * keep the leaderboard page open across each change and assert it follows without a reload
 * (#362). Act 7 (#749) runs a contest over two more tournaments on the same tour: the
 * commissioner adds the second on the contest's Events page, and the member's entry and the
 * leaderboard switch between them.
 *
 * Shape: one `test()` per act in a serial file. Tags select tests, not steps (plans/130 §"What
 * act 1 found when it ran"), so acts 1-3, which run post-deploy, sit in a describe tagged
 * `@smoke`, and acts 4-7, which do not, sit outside it — a tag cannot be removed from a test
 * inside a tagged block. Serial mode keeps every act in one worker, in order, so act 1's ids
 * reach the later acts through module state rather than by re-creating the catalog, and a failure
 * skips the acts after it. The HTML report names the failing act in the test title and the
 * failing stage in its steps.
 *
 * Acts 1-3 run against QA as well as the local stack (plans/130 §"Owner ruling"), so the file is
 * safe against a shared, persistent database by construction rather than by refusing to run
 * there:
 *
 * - every name it creates carries a per-attempt run id, so two runs never touch each other's
 *   rows and anything left behind is identifiable;
 * - it reads nothing by identity except the root admin, the golf sport row and the seeded PGA
 *   TOUR, whose current Season takes the run's test slots (#2004), and it never changes that tour;
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
  tourId?: string;
  playerIds?: string[];
  eventId?: string;
  /** The tournament's year: its contest's season, so the year of the tour's cup (#841). */
  /** The championship year of the Season the tournament went in: the year its cup is in. */
  championshipYear?: number;
  /** Field-entry ids in tier order: entry `i` sits alone in `tier-${i + 1}`. */
  fieldEntryIds?: string[];
  commissionerId?: string;
  /** Kept so act 7 can sign the commissioner and the member back in. */
  commissionerPassword?: string;
  memberPassword?: string;
  leagueId?: string;
  contestId?: string;
  joinUrl?: string;
  memberId?: string;
  entryId?: string;
  /** #93 — the budget contest act 2 opens beside the tiered one, and the member's entry in it. */
  budgetContestId?: string;
  budgetEntryId?: string;
};

/**
 * #93 — the budget contest's prices. Auto-pricing spreads the field along the curve by the seeds
 * act 1 sets, top seed first: the
 * dearest two come to $20,500 ($12,000 + $8,500), which with $30,000 is over the $50,000 cap.
 * Act 1 sets by hand the four golfers act 3 picks: three of them cost more than the cap
 * ($30,000 + $20,000 + $6,000), and swapping the $20,000 golfer for the other $6,000 golfer fits
 * under it ($42,000). Field entry index → price.
 */
const BUDGET_PRICES: ReadonlyArray<{ index: number; price: number }> = [
  { index: 0, price: 30_000 },
  { index: 1, price: 20_000 },
  { index: 2, price: 6_000 },
  { index: 3, price: 6_000 },
];
const BUDGET_ROSTER_SIZE = 3;

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
  test('act 1: the root admin builds a golf catalog — tour, six players, a tournament, its field, tiers and prices — and releases it', async ({ page }) => {
    test.setTimeout(180_000);
    const credentials = readAdminCredentials();
    admin = credentials;

    // Inside the test body, not at module load: a retry re-imports this module in a new worker
    // and must get its own id rather than collide with its first attempt.
    const runId = newRunId();
    const run: JourneyRun = {
      runId,
      sport: 'GOLF',
      tourUrlSegment: 'pga',
      playerNamePrefix: e2eName('Golfer', runId),
      tournamentName: e2eName('Open', runId),
      moreTournamentNames: [e2eName('Classic', runId), e2eName('Invitational', runId)],
      // RFC 2606 reserves .invalid, so nothing sent to these can reach a real mailbox.
      commissioner: {
        username: e2eUsername('c', runId),
        email: e2eEmail('c', runId),
        firstName: 'E2E',
        lastName: `Commissioner ${runId}`,
      },
      member: {
        username: e2eUsername('m', runId),
        email: e2eEmail('m', runId),
        firstName: 'E2E',
        lastName: `Member ${runId}`,
      },
      leagueName: e2eName('League', runId),
      leagueCode: e2eLeagueCode('', runId),
      contestName: e2eName('Pick Six', runId),
      squadName: e2eName('Squad', runId),
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
      await expect(page).toHaveURL(/\/manage\/sports(\?.*)?$/);
      await expect(page.getByTestId('root-admin-manage-menu-sports')).toBeVisible();
      await expect(page.getByTestId('root-admin-sports-table')).toBeVisible();
      await expectListPageLoaded(page, '/manage/customers/leagues', 'root-admin-customer-leagues-page', 'root-admin-customer-leagues-table');
      await expectListPageLoaded(page, '/manage/customers/users', 'root-admin-customer-users-page', 'root-admin-customer-users-table');
      await expectListPageLoaded(page, '/manage/plans', 'root-admin-plans-page', 'root-admin-plans-caps');
    });

    const tourId = await test.step('find the seeded golf tour on the Sports page', async () => {
      // A league is added by migration, so a journey plays in a seeded one (#2004).
      const { id } = await findSeededSportLeague(page, 'GOLF', run.tourUrlSegment);
      await page.goto('/manage/sports');
      await expect(page.getByTestId(`root-admin-sports-row-${id}`)).toBeVisible();
      return id;
    });
    journey.tourId = tourId;

    const playerIds = await test.step(`create ${PLAYER_COUNT} test players`, async () => {
      const names = Array.from({ length: PLAYER_COUNT }, (_, index) => `${run.playerNamePrefix} ${index + 1}`);
      // Test participants (#2096): the tour's real golfers come only from its feed.
      return addTestParticipants(page.request, { 'x-csrf-token': await readCsrfToken(page) }, tourId, 'INDIVIDUAL', names);
    });
    journey.playerIds = playerIds;

    // plans/147, #2003 — a tournament is one Season's edition on a tour, made in its current Season.
    const { eventId, championshipYear } = await test.step('create a tournament on the tour, in its current Season', async () => {
      const now = new Date();
      const start = addDays(now, 7);
      start.setHours(8, 0, 0, 0);
      const created = await createTestEvent(page, {
        sportUrlSegment: 'golf',
        sportLeagueId: tourId,
        slotKind: 'TOURNAMENT',
        slotLabel: run.tournamentName,
        startsAt: start,
        name: run.tournamentName,
      });
      return { eventId: created.id, championshipYear: created.championshipYear };
    });
    journey.eventId = eventId;
    journey.championshipYear = championshipYear;

    await test.step(`load the ${PLAYER_COUNT} players into the field in one submit`, async () => {
      await page.goto(`/manage/sports/golf/events/${eventId}/field`);
      await page.getByTestId('root-admin-event-field-add').click();
      await expect(page.getByTestId('root-admin-event-field-add-modal')).toBeVisible();
      // The free-text search spans every participant, so the players need no tour roster.
      await page.getByTestId('root-admin-event-field-add-search').fill(runId);
      for (const id of playerIds) {
        const candidate = page.getByTestId(`root-admin-event-field-add-candidate-${id}`);
        await candidate.click();
        await expect(candidate).toHaveAttribute('aria-pressed', 'true');
      }
      await submitAndRead(
        page,
        'root-admin-event-field-add-modal-apply',
        'POST',
        `/api/v1/events/${eventId}/participants`,
      );
      await expect(page.getByTestId('root-admin-event-field-add-modal')).toBeHidden();
    });

    journey.fieldEntryIds = await test.step('place one player in each default tier, with a seed to price by, one participant dialog at a time', async () => {
      await page.goto(`/manage/sports/golf/events/${eventId}/field`);
      // The grid's rows are keyed by field entry, not player, so the act needs that mapping.
      // It reads it straight from the API rather than by sniffing the page's own response.
      //
      // A `waitForResponse` registered before this navigation could match the FIELD page's
      // refetch of the very same path -- both pages read it through `useSportEventFieldQuery`, and
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
          throw new Error(`player ${playerId} is not in the field the Field tab loaded`);
        }
        return entry.id;
      });

      for (const [index, entryId] of entryIds.entries()) {
        // A freshly added golfer starts untiered; its dialog's Edit moves it into a tier.
        await expect(page.getByTestId(`root-admin-event-field-row-${entryId}`)).toBeVisible();
        // Seeds give the field an order to price by: a field with no odds, seed or rank is refused.
        await correctFieldParticipant(page, eventId, entryId, { tierKey: `tier-${index + 1}`, seedNumber: index + 1 });
        await expect(page.getByTestId(`root-admin-event-field-row-${entryId}`)).toContainText(`Tier ${index + 1}`);
      }
      return entryIds;
    });

    await test.step('price the field with the tour\'s pricing profile', async () => {
      // Release needs every active golfer priced (#93); the dialog starts on the default profile.
      await page.getByTestId('root-admin-tier-auto-prices').click();
      await expect(page.getByTestId('root-admin-tier-auto-prices-modal')).toBeVisible();
      await expect(page.getByTestId('root-admin-tier-auto-prices-preview')).toBeVisible();
      await submitAndRead(
        page,
        'root-admin-tier-auto-prices-confirm',
        'POST',
        `/api/v1/events/${eventId}/prices/auto-assign`,
      );
      await page.getByTestId('root-admin-event-settings').click();
      await expect(page.getByTestId('root-admin-event-settings-dialog-priced-with')).not.toHaveText(/Not priced yet/);
      await page.getByTestId('root-admin-event-settings-dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByTestId('root-admin-event-settings-dialog')).toBeHidden();
    });

    await test.step('set four golfers\' prices in their Field dialogs, so a budget roster can go over the cap and a swap brings it under', async () => {
      const fieldEntryIds = journey?.fieldEntryIds ?? [];
      for (const { index, price } of BUDGET_PRICES) {
        await correctFieldParticipant(page, eventId, fieldEntryIds[index], { price });
      }
    });

    // #431 — a new tournament is a draft commissioners can't see. Act 2 can only create a
    // contest on one that is released, has a field, and has not started (`contestEligible`).
    const firstFieldEntryId = journey.fieldEntryIds[0];
    await test.step('release the tournament for contests, which locks its tiers', async () => {
      await page.goto(`/manage/sports/golf/events/${eventId}`);
      await page.getByTestId('root-admin-event-release-chip').click();
      await expect(page.getByTestId('root-admin-sport-event-release')).toBeEnabled();
      await page.getByTestId('root-admin-sport-event-release').click();
      await expect(page.getByTestId('root-admin-sport-event-release-modal')).toBeVisible();
      const released = await submitAndRead<{ event: { status: string } }>(
        page,
        'root-admin-sport-event-release-confirm',
        'POST',
        `/api/v1/events/${eventId}/release`,
      );
      expect(released.event.status).toBe('SCHEDULED');
      await expect(page.getByTestId('root-admin-event-release-chip')).toHaveCount(0);

      // Released, automatic tiers leave the Field section and a golfer's tier is no longer editable.
      await page.goto(`/manage/sports/golf/events/${eventId}/field`);
      await expect(page.getByTestId(`root-admin-event-field-row-${firstFieldEntryId}`)).toBeVisible();
      await expect(page.getByTestId('root-admin-tier-auto-tiers')).toHaveCount(0);
      await openFieldParticipant(page, firstFieldEntryId);
      await page.getByTestId('root-admin-event-participant-dialog-edit').click();
      await expect(page.getByTestId('root-admin-event-participant-dialog-edit-tier')).toHaveCount(0);
      await page.getByTestId('root-admin-event-participant-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      await closeFieldParticipant(page);
    });

    await test.step('root admin logs out', async () => {
      await logOut(page);
    });
  });

  test('act 2: a new commissioner creates a league, a tiered and a budget contest on the catalog, opens them to the league, then hands out a join link', async ({ page }) => {
    test.setTimeout(120_000);
    const state = requireJourney();
    const { run } = state;

    await test.step('a fresh commissioner registers', async () => {
      await page.goto('/');
      await page.getByTestId('auth-mode-register').click();
      state.commissionerPassword = generatePassword();
      state.commissionerId = await registerFreshUser(page, run.commissioner, state.commissionerPassword);
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
      const created = await submitAndRead<{ league: { id: string; leagueCode: string } }>(
        page,
        'create-league-submit',
        'POST',
        '/api/v1/leagues',
      );
      expect(created.league.leagueCode).toBe(run.leagueCode);
      state.leagueId = created.league.id;
      await expect(page.getByTestId('league-home')).toBeVisible();
      await expect(page.getByTestId('league-home-identity-name')).toHaveText(run.leagueName);
    });

    await test.step('create a contest on act 1\'s tournament: one pick per tier on six tiers, counted 4, one entry per member', async () => {
      // Contest setup lives in Commissioner tools, reached from the league menu.
      await page.getByTestId('league-menu-commissioner-tools').click();
      await page.getByTestId('commissioner-tools-menu-contests').click();
      await expect(page.getByTestId('manage-contests-page')).toBeVisible();
      await page.getByTestId('manage-contests-create-link').click();
      await expect(page.getByTestId('create-contest-page')).toBeVisible();
      // The event list holds every contest-eligible golf event on the platform, QA's whole
      // catalog included, so the run's own tournament is chosen by its id and checked by its name.
      const eventChoice = page.getByTestId(`contest-event-${state.eventId}`);
      await expect(eventChoice).toContainText(run.tournamentName);
      await eventChoice.click();
      await expect(eventChoice).toBeChecked();
      await page.getByTestId('contest-name').fill(run.contestName);
      await page.getByTestId('contest-max-entries-unlimited').uncheck();
      await page.getByTestId('contest-max-entries').fill('1');
      await page.getByTestId('contest-tiered-picks-per-tier').fill('1');
      await page.getByTestId('contest-tiered-counted-scores').fill('4');
      const created = await submitAndRead<{ contest: { id: string; name: string } }>(
        page,
        'create-contest-submit',
        'POST',
        `/api/v1/leagues/${state.leagueId}/contests`,
      );
      expect(created.contest.name).toBe(run.contestName);
      state.contestId = created.contest.id;
    });

    await test.step('the new contest is a draft on its setup page, and its configuration still takes an edit', async () => {
      // #117 — create saves a draft and lands the commissioner on its setup page.
      await expect(page).toHaveURL(new RegExp(`/league/${run.leagueCode}/admin/contests/${state.contestId}$`));
      await expect(page.getByTestId('manage-contest-page')).toBeVisible();
      const managed = await readManagedContest(page, state.leagueId, state.contestId);
      expect(managed.contest.status).toBe('DRAFT');
      // The control for the lock below: the very same request, byte for byte, is accepted here
      // and refused once the contest is open, so the refusal can only be the release's doing.
      const accepted = await putContestConfigurationUnchanged(page, state.leagueId, state.contestId);
      expect(accepted.status, `PUT the contest configuration answered ${accepted.status}`).toBe(200);
    });

    await test.step('open the contest to the league, after which its configuration is locked', async () => {
      await page.getByTestId('contest-open-to-league').click();
      await expect(page.getByTestId('contest-open-dialog')).toBeVisible();
      const opened = await submitAndRead<{ contest: { status: string } }>(
        page,
        'contest-open-confirm',
        'POST',
        `/api/v1/leagues/${state.leagueId}/contest-management/contests/${state.contestId}/open`,
      );
      expect(opened.contest.status).toBe('OPEN');
      await expect(page.getByTestId('manage-contest-locked')).toBeVisible();
      await expect(page.getByTestId('contest-open-to-league')).toHaveCount(0);

      const refused = await putContestConfigurationUnchanged(page, state.leagueId, state.contestId);
      expect(refused.status, `PUT the contest configuration answered ${refused.status}`).toBe(409);
      // The documented code, not a generic failure. The sentence that comes with it is
      // deliberately not asserted: the code is the contract, the prose is not.
      expect(refused.errorCode).toBe('CONTEST_CONFIGURATION_LOCKED');
    });

    await test.step('the contest is on the board with no entries, and on League Home, where the old Contests link now lands', async () => {
      await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
      await expect(page.getByTestId('contest-board')).toBeVisible();
      await expect(page.getByTestId('contest-page-header-name')).toHaveText(run.contestName);
      // The contest is this run's own and seconds old: zero entries is a fact about it, not
      // about anything else in the database. The new league is on its Premium gift, whose cap of
      // 100 entries per contest the board shows beside the count.
      await expect(page.getByTestId('contest-board-total-count')).toHaveText(/\b0 of 100 entered$/);
      await page.goto(`/league/${run.leagueCode}/contests`);
      await expect(page).toHaveURL(new RegExp(`/league/${run.leagueCode}$`));
      await expect(page.getByTestId('league-home')).toBeVisible();
      // Open for entries, it is a hero; were three others ahead of it, a More contests row.
      await expect(
        page.getByTestId(`league-home-hero-${state.contestId}-name`).or(page.getByTestId(`league-home-contest-${state.contestId}`)),
      ).toContainText(run.contestName);
    });

    await test.step('create a budget contest on the same tournament, three golfers under its $50,000 cap, and open it', async () => {
      await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
      await expect(page.getByTestId('create-contest-page')).toBeVisible();
      const eventChoice = page.getByTestId(`contest-event-${state.eventId}`);
      await eventChoice.click();
      await expect(eventChoice).toBeChecked();
      await page.getByTestId('contest-format-BUDGET_PICK').click();
      await expect(page.getByTestId('contest-budget-salary-cap')).toContainText('$50,000 salary cap');
      await page.getByTestId('contest-name').fill(e2eName('Budget', run.runId));
      await page.getByTestId('contest-budget-roster-size').fill(String(BUDGET_ROSTER_SIZE));
      await page.getByTestId('contest-budget-counted-scores').fill(String(BUDGET_ROSTER_SIZE));
      const created = await submitAndRead<{ contest: { id: string; selectionType: string } }>(
        page,
        'create-contest-submit',
        'POST',
        `/api/v1/leagues/${state.leagueId}/contests`,
      );
      expect(created.contest.selectionType).toBe('BUDGET_PICK');
      state.budgetContestId = created.contest.id;

      await expect(page.getByTestId('manage-contest-page')).toBeVisible();
      await expect(page.getByTestId('manage-contest-rules')).toContainText('$50,000 salary cap');
      await page.getByTestId('contest-open-to-league').click();
      const opened = await submitAndRead<{ contest: { status: string } }>(
        page,
        'contest-open-confirm',
        'POST',
        `/api/v1/leagues/${state.leagueId}/contest-management/contests/${state.budgetContestId}/open`,
      );
      expect(opened.contest.status).toBe('OPEN');
    });

    await test.step('edit the league description', async () => {
      const description = `Edited by the commissioner, run ${run.runId}`;
      // Commissioner tools, reached from the league menu, holds the league's settings.
      await page.goto(`/league/${run.leagueCode}`);
      await page.getByTestId('league-menu-commissioner-tools').click();
      await page.getByTestId('league-settings-edit').click();
      await page.getByTestId('edit-league-description').fill(description);
      const saved = await submitAndRead<{ league: { description: string | null } }>(
        page,
        'edit-league-save',
        'PUT',
        `/api/v1/leagues/${state.leagueId}/details`,
      );
      expect(saved.league.description).toBe(description);
      await expect(page.getByTestId('league-settings-page')).toBeVisible();
      await page.goto(`/league/${run.leagueCode}`);
      await expect(page.getByTestId('league-home-description')).toHaveText(description);
    });

    await test.step('set the championship points table to Top ten, and make the budget contest count double', async () => {
      // League settings › Championships holds the table every cup and the championship score on.
      await page.goto(`/league/${run.leagueCode}/admin`);
      await page.getByTestId('league-settings-championships-edit').click();
      await page.getByTestId('edit-championships-scale-TOP_TEN').click();
      await expect(page.getByTestId('championship-points-preview-1st')).toContainText('25');
      const settings = await submitAndRead<{ league: { cupPointsScale: string } }>(
        page,
        'edit-championships-save',
        'PUT',
        `/api/v1/leagues/${state.leagueId}/cup-settings`,
      );
      expect(settings.league.cupPointsScale).toBe('TOP_TEN');
      await expect(page.getByTestId('league-settings-points-table')).toContainText('Top ten');

      // A contest's weight is set on its own page and holds until it is final.
      await page.goto(`/league/${run.leagueCode}/admin/contests/${state.budgetContestId}`);
      await page.getByTestId('manage-contest-cup-weight-edit').click();
      await page.getByTestId('edit-cup-weight-DOUBLE').click();
      const weighted = await submitAndRead<{ contest: { cupWeight: string } }>(
        page,
        'edit-cup-weight-save',
        'PUT',
        `/api/v1/leagues/${state.leagueId}/contest-management/contests/${state.budgetContestId}/cup-weight`,
      );
      expect(weighted.contest.cupWeight).toBe('DOUBLE');
      await expect(page.getByTestId('manage-contest-cup-weight')).toContainText('Double (x2)');
    });

    await test.step('generate the join URL in Commissioner tools › Invites, and see it pending', async () => {
      // Inviting members lives in Commissioner tools, beside the invites still pending.
      await page.goto(`/league/${run.leagueCode}/admin/invites`);
      const created = await submitAndRead<{ invitation: { id: string; inviteCode: string } }>(
        page,
        'league-create-join-url',
        'POST',
        `/api/v1/leagues/${state.leagueId}/invite-link`,
      );
      const joinUrl = page.getByTestId('league-join-url');
      await expect(joinUrl).toHaveValue(new RegExp(`/invite/${created.invitation.inviteCode}$`));
      // The hand-off to act 3: the string a commissioner would copy and send.
      state.joinUrl = await joinUrl.inputValue();
      await expect(page.getByTestId(`league-invitation-${created.invitation.id}`)).toContainText('Join link');
    });

    await test.step('the commissioner logs out', async () => {
      await logOut(page);
    });
  });

  test('act 3: a new member joins by the link, submits a six-tier entry, and a budget entry once a swap brings it under the cap', async ({ page }) => {
    test.setTimeout(120_000);
    const state = requireJourney();
    const { run } = state;

    await test.step('open the join URL signed out and register through the invite', async () => {
      await page.goto(state.joinUrl);
      // Signed out, the invite page offers only sign-in or registration; registration carries
      // the invite path through and returns to it.
      await page.getByTestId('invite-create-account').click();
      state.memberPassword = generatePassword();
      state.memberId = await registerFreshUser(page, run.member, state.memberPassword);
      await expect(page.getByTestId('join-league-page')).toBeVisible();
    });

    await test.step('name the squad, pick an icon, and accept', async () => {
      await page.getByTestId('join-league-team-name').fill(run.squadName);
      await page.getByTestId('join-league-team-icon-CAPTAIN_SMILE_OCEAN').click();
      await page.getByTestId('invite-accept').click();
      await expect(page.getByTestId('league-home')).toBeVisible();
      await expect(page.getByTestId('league-home-identity-name')).toHaveText(run.leagueName);
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
          'PUT',
          `/api/v1/selections/${state.contestId}/entries/${state.entryId}/picks/${fieldEntryId}`,
        );
        await expect(page.getByTestId(`contest-entry-selected-${fieldEntryId}`)).toBeVisible();
      }
      // Any offered value: the tiebreaker is required, its value is not under test.
      await page.getByTestId('contest-entry-tiebreaker-select').selectOption({ index: 1 });
      // The button saves the tiebreaker, then submits the entry (#481); only a submitted entry
      // counts on the leaderboard and at settlement, so wait for the submit itself.
      await submitAndRead(
        page,
        'contest-entry-submit',
        'POST',
        `/api/v1/selections/${state.contestId}/entries/${state.entryId}/events/${state.eventId}/submit`,
      );
    });

    await test.step('the entry is on the board as the member\'s own', async () => {
      await expect(page.getByTestId('contest-board')).toBeVisible();
      await expect(page.getByTestId(`contest-board-entry-${state.entryId}`)).toBeVisible();
      await expect(page.getByTestId(`contest-board-entry-${state.entryId}`)).toHaveAttribute('data-mine', 'true');
      await expect(page.getByTestId(`contest-board-entry-status-${state.entryId}`)).toHaveText('Submitted');
    });

    await test.step('the entry page shows its six picks', async () => {
      await page.getByTestId(`contest-board-edit-entry-${state.entryId}`).click();
      await expect(page.getByTestId('contest-entry-builder-heading')).toBeVisible();
      for (const fieldEntryId of state.fieldEntryIds) {
        await expect(page.getByTestId(`contest-entry-selected-${fieldEntryId}`)).toBeVisible();
      }
    });

    await test.step('rename the submitted entry on its pick screen with Save, then find the new name on the contest page', async () => {
      const name = e2eName('Entry', run.runId);
      await page.getByTestId('contest-entry-name-input').fill(name);
      const renamed = await submitAndRead<{ entry: { name: string } }>(
        page,
        'contest-entry-save',
        'PATCH',
        `/api/v1/contests/${state.contestId}/entries/${state.entryId}`,
      );
      expect(renamed.entry.name).toBe(name);
      await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
      await expect(page.getByTestId('contest-board')).toBeVisible();
      await expect(page.getByTestId(`contest-board-entry-${state.entryId}`)).toContainText(name);
    });

    await test.step('enter the budget contest: three golfers over the cap cannot be submitted, a swap under it can', async () => {
      const budgetContestId = state.budgetContestId;
      const [dearest, dear, floorA, floorB] = state.fieldEntryIds;
      await page.goto(`/league/${run.leagueCode}/contests/${budgetContestId}`);
      const created = await submitAndRead<{ entry: { id: string } }>(
        page,
        'contest-board-create-entry',
        'POST',
        `/api/v1/contests/${budgetContestId}/entries/me`,
      );
      state.budgetEntryId = created.entry.id;
      const budgetEntryId = created.entry.id;
      await expect(page.getByTestId('contest-entry-budget-builder')).toBeVisible();

      for (const fieldEntryId of [dearest, dear, floorA]) {
        await submitAndRead(page, `contest-entry-participant-${fieldEntryId}`, 'PUT', `/api/v1/selections/${budgetContestId}/entries/${budgetEntryId}/picks/${fieldEntryId}`);
        await expect(page.getByTestId(`contest-entry-selected-${fieldEntryId}`)).toBeVisible();
      }
      // Over the cap the page says so and Submit stays disabled, whatever the tiebreaker.
      await expect(page.getByTestId('contest-entry-over-budget')).toBeVisible();
      await page.getByTestId('contest-entry-tiebreaker-select').selectOption({ index: 1 });
      await expect(page.getByTestId('contest-entry-finish-status')).toContainText('over the $50,000 salary cap');
      await expect(page.getByTestId('contest-entry-submit')).toBeDisabled();

      // The swap: tap the $20,000 golfer off, then add the other $6,000 one.
      await submitAndRead(page, `contest-entry-selected-${dear}`, 'DELETE', `/api/v1/selections/${budgetContestId}/entries/${budgetEntryId}/picks/${dear}`);
      await submitAndRead(page, `contest-entry-participant-${floorB}`, 'PUT', `/api/v1/selections/${budgetContestId}/entries/${budgetEntryId}/picks/${floorB}`);
      await expect(page.getByTestId('contest-entry-over-budget')).toHaveCount(0);
      await page.getByTestId('contest-entry-tiebreaker-select').selectOption({ index: 1 });
      await submitAndRead(
        page,
        'contest-entry-submit',
        'POST',
        `/api/v1/selections/${budgetContestId}/entries/${state.budgetEntryId}/events/${state.eventId}/submit`,
      );
      await expect(page.getByTestId(`contest-board-entry-${state.budgetEntryId}`)).toBeVisible();
    });

    await test.step('change a preference on the account page', async () => {
      await page.goto('/my-account');
      await expect(page.getByTestId('my-account-page')).toBeVisible();
      await page.getByTestId('my-account-preferences-edit').click();
      await page.getByTestId('my-account-time-zone').selectOption('America/Chicago');
      await submitAndRead(page, 'my-account-preferences-save', 'PUT', '/api/v1/users/me/preferences');
      await expect(page.getByTestId('my-account-preferences-time-zone')).toHaveText(/Central \(Chicago\)/);
    });

    await test.step('open the league All years page', async () => {
      await page.goto(`/league/${run.leagueCode}/history`);
      await expect(page.getByTestId('all-years-page')).toBeVisible();
      // A failed read draws its error line as an alert.
      await expect(page.getByRole('alert')).toHaveCount(0);
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
  // The leaderboard page left open across the start waits out one of its own polls.
  test.setTimeout(240_000);
  const state = requireJourney();
  const { run } = state;
  const credentials = readAdminCredentials();

  await test.step('root admin signs in', async () => {
    await adminSignIn(page, credentials);
  });

  await test.step('enter round-1 scores for the six players', async () => {
    await uploadRoundScores(
      page,
      state.eventId,
      1,
      Array.from({ length: PLAYER_COUNT }, (_, index) => ({
        playerName: `${run.playerNamePrefix} ${index + 1}`,
        strokes: 70 + index,
        scoreToPar: index - 2,
      })),
    );
    for (const fieldEntryId of state.fieldEntryIds) {
      await expect(page.getByTestId(`root-admin-golf-scores-strokes-${fieldEntryId}`)).toBeVisible();
    }
  });

  // #362 — opened before play, as a member watching for the start would have it. The contest is
  // still open, so its page lists the entries (#1739).
  const leaderboardTab = await test.step('open the contest page before the event starts: it lists the entries', async () => {
    const tab = await openLeaderboardTab(page, run.leagueCode, state.contestId);
    await expect(tab.getByTestId(`contest-board-entry-${state.entryId}`)).toBeVisible();
    await expect(tab.getByTestId('contest-leaderboard')).toHaveCount(0);
    await page.bringToFront();
    return tab;
  });

  await test.step('move the tournament to in progress', async () => {
    await page.goto(`/manage/sports/golf/events/${state.eventId}`);
    await page.getByTestId('root-admin-event-settings').click();
    await page.getByTestId('root-admin-sport-event-transition-IN_PROGRESS').click();
    const moved = await submitAndRead<{ event: { status: string } }>(
      page,
      'root-admin-sport-event-transition-confirm',
      'POST',
      `/api/v1/events/${state.eventId}/transition`,
    );
    expect(moved.event.status).toBe('IN_PROGRESS');
  });

  await test.step('the contest page opened before the start turns into the leaderboard without a reload', async () => {
    // The browser reproduction of #362: before the fix this page kept the contest status it
    // loaded with and never fetched the leaderboard again.
    await leaderboardTab.bringToFront();
    await expect(leaderboardTab.getByTestId(`contest-leaderboard-entry-${state.entryId}`))
      .toBeVisible({ timeout: LIVE_PAGE_TIMEOUT_MS });
    await expect(leaderboardTab.getByTestId('contest-board-entries')).toHaveCount(0);
    await leaderboardTab.close();
  });

  await test.step('the member\'s budget entry is on its contest\'s leaderboard', async () => {
    const tab = await openLeaderboardTab(page, run.leagueCode, state.budgetContestId);
    await expect(tab.getByTestId(`contest-leaderboard-entry-${state.budgetEntryId}`))
      .toBeVisible({ timeout: LIVE_PAGE_TIMEOUT_MS });
    await tab.close();
    await page.bringToFront();
  });

  await test.step('the member\'s picks are revealed on the contest page, now its leaderboard, and each carries a score', async () => {
    // This read checks every golfer has a round-1 score; the page then shows the entry's picks.
    const leaderboard = await page.request.get(`/api/v1/contests/${state.contestId}/leaderboard`);
    expect(leaderboard.ok(), `GET the leaderboard answered ${leaderboard.status()}`).toBe(true);
    const { participants, entries } = (await leaderboard.json()) as {
      participants: { id: string; rounds?: { roundNumber: number; golf?: { strokes: number } | null }[] }[];
      entries: { entryId: string; picks: { pickId: string }[] }[];
    };
    const scored = participants.filter(
      (participant) =>
        state.fieldEntryIds.includes(participant.id)
        && participant.rounds?.some((round) => round.roundNumber === 1 && round.golf != null),
    );
    expect(scored.map((participant) => participant.id).sort()).toEqual([...state.fieldEntryIds].sort());

    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    // The root admin has no entry of their own, so the member's row starts closed.
    await page.getByTestId(`contest-leaderboard-entry-toggle-${state.entryId}`).click();
    const picks = entries.find((entry) => entry.entryId === state.entryId)?.picks ?? [];
    expect(picks).toHaveLength(state.fieldEntryIds.length);
    for (const pick of picks) {
      await expect(page.getByTestId(`contest-leaderboard-pick-${state.entryId}-${pick.pickId}`)).toBeVisible();
    }
  });

  await test.step('the new league and both new users are visible to the root admin', async () => {
    // Both Customers grids load every row and filter in the browser (#1883).
    await expectListPageLoaded(page, '/manage/customers/leagues', 'root-admin-customer-leagues-page', 'root-admin-customer-leagues-table');
    await filterGridText(page, 'root-admin-customer-leagues-filter-name', run.leagueName);
    await expect(page.getByTestId(`root-admin-customer-league-${state.leagueId}`)).toBeVisible();
    await expectListPageLoaded(page, '/manage/customers/users', 'root-admin-customer-users-page', 'root-admin-customer-users-table');
    // Both new users' last names carry the run id.
    await filterGridText(page, 'root-admin-customer-users-filter-name', run.runId);
    await expect(page.getByTestId(`root-admin-customer-user-${state.commissionerId}`)).toBeVisible();
    await expect(page.getByTestId(`root-admin-customer-user-${state.memberId}`)).toBeVisible();
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

/**
 * Act 5's round plans: each golfer's score to par for one round, in the order act 1 created the
 * players (index 0 is `${playerNamePrefix} 1`). Act 4's round 1 runs -2 to +3, so round 2 here
 * reverses the field outright and round 3 moves it again without re-reversing it, and each one
 * changes which four of the entry's six picks count.
 *
 * The act asserts nothing against these numbers — every assertion compares a leaderboard read
 * against the read before it — but a plan that left the field's order or the counting set alone
 * would make those comparisons vacuous, so they are chosen rather than arbitrary.
 */
const ACT_5_ROUND_PLANS: ReadonlyArray<{ round: number; scoresToPar: readonly number[] }> = [
  { round: 2, scoresToPar: [5, 2, -1, -4, -7, -10] },
  { round: 3, scoresToPar: [-6, -3, 0, -1, -1, -1] },
];

/** The round act 5 corrects one golfer at a time in: the last one it loaded. */
const CORRECTED_ROUND = 3;

/** Par for one round, so an uploaded row's strokes and its score to par agree. */
const PAR_PER_ROUND = 72;

/**
 * How far a one-golfer correction moves that golfer's round, in strokes. Applied as a penalty to
 * the entry's worst dropped pick (which stays dropped: it was already last) and as a gain to its
 * best counting pick (which stays counting: it was already first), so neither correction can
 * reshuffle the counting set it is meant to hold still.
 */
const CORRECTION_STROKES = 5;

// Act 5 is OUTSIDE the tagged describe for the same reason act 4 is: it writes round scores and
// drives event state, and a tagged act writes to QA on every push to main.
test('act 5: each round of scores moves the leaderboard, and only a counted pick\'s change moves an entry total', async ({ page }) => {
  test.setTimeout(240_000);
  const state = requireJourney();
  const { run } = state;
  const credentials = readAdminCredentials();

  await test.step('root admin signs in', async () => {
    await adminSignIn(page, credentials);
  });

  // #362 — left open for the whole act, so each round has to reach it by the page's own poll.
  const leaderboardTab = await test.step('open the leaderboard page on the round-1 standings', async () => {
    const tab = await openLeaderboardTab(page, run.leagueCode, state.contestId);
    await expect(tab.getByTestId(`contest-leaderboard-entry-${state.entryId}`)).toBeVisible();
    await page.bringToFront();
    return tab;
  });

  const afterRound1 = await test.step('the round-1 leaderboard act 4 left behind is the baseline', async () => {
    const read = await readContestLeaderboard(page, state.contestId, state.entryId);
    // Best-N-of-M has to be live for the asymmetry this act ends on to mean anything: a contest
    // that counted every pick could not drop one. Act 2 created it one pick per tier on six tiers, counted 4.
    expect(read.countingRuleCount).toBeLessThan(PLAYER_COUNT);
    expect(read.entry.countingPickLimit).toBe(read.countingRuleCount);
    expect(read.entry.scoredPickCount).toBe(PLAYER_COUNT);
    expectCountingPicksExplainTheTotal(read);
    return read;
  });

  let previous = afterRound1;
  for (const plan of ACT_5_ROUND_PLANS) {
    const before = previous;
    previous = await test.step(`round ${plan.round} lands, and the leaderboard is no longer the one before it`, async () => {
      await uploadRoundScores(
        page,
        state.eventId,
        plan.round,
        state.fieldEntryIds.map((_, index) => ({
          playerName: `${run.playerNamePrefix} ${index + 1}`,
          strokes: PAR_PER_ROUND + plan.scoresToPar[index],
          scoreToPar: plan.scoresToPar[index],
        })),
      );
      // The corrections grid lists only the golfers with a score in the selected round, so the
      // six inputs carrying the uploaded strokes are this round's write read back in the UI.
      for (const [index, fieldEntryId] of state.fieldEntryIds.entries()) {
        await expect(page.getByTestId(`root-admin-golf-scores-strokes-${fieldEntryId}`))
          .toHaveValue(String(PAR_PER_ROUND + plan.scoresToPar[index]));
      }

      const read = await readContestLeaderboardOnceRebuilt(page, state.contestId, state.entryId, (rebuilt) => {
        expectCountingPicksExplainTheTotal(rebuilt);
        // What a leaderboard that tracks scoring has to change when a round lands, none of it a
        // number this file chose: the entry's total, the order the field is placed in, and which
        // of the entry's picks count.
        expect(rebuilt.entry.total).not.toBe(before.entry.total);
        expect(rebuilt.placedOrder).not.toEqual(before.placedOrder);
        expect([...rebuilt.entry.countingIds].sort()).not.toEqual([...before.entry.countingIds].sort());
      });
      // The entry's own rank has nowhere to move: it is the contest's only entry, so it is
      // first before and after. The ranks that do move are the field's, asserted through
      // `placedOrder` above. A second ranked entry needs a second squad and a second draft.
      expect(read.entry.position).toBe(1);

      // The page that was open before this round landed shows it without a reload. Presence
      // only: the arithmetic is asserted on the read above.
      await expectLeaderboardPageShowsRound(leaderboardTab, state.entryId, read.entry.pickIds, plan.round);
      return read;
    });
  }
  const afterRound3 = previous;
  await leaderboardTab.close();

  const afterPenalty = await test.step('a penalty on a pick that does not count moves that golfer and not the entry total', async () => {
    const dropped = worstOf(afterRound3, afterRound3.entry.droppedIds);
    const scoreBefore = scoreOn(afterRound3, dropped);
    const delta = await correctOneGolfersRound(page, state.eventId, CORRECTED_ROUND, afterRound3, dropped, CORRECTION_STROKES);

    const read = await readContestLeaderboardOnceRebuilt(page, state.contestId, state.entryId, (rebuilt) => {
      // The write landed — the golfer's own event total moved by exactly the round's change …
      expect(scoreOn(rebuilt, dropped)).toBe(scoreBefore + delta);
    });
    expectCountingPicksExplainTheTotal(read);
    // … the pick it belongs to is still dropped, having only got worse …
    expect(read.entry.droppedIds).toContain(dropped);
    // … and the entry's total, and the four picks that make it, did not move at all.
    expect(read.entry.total).toBe(afterRound3.entry.total);
    expect(read.entry.countingIds).toEqual(afterRound3.entry.countingIds);
    expect(read.entry.scoredPickCount).toBe(afterRound3.entry.scoredPickCount);
    return read;
  });

  await test.step('the same correction on a pick that counts moves the entry total by exactly its change', async () => {
    const counting = bestOf(afterPenalty, afterPenalty.entry.countingIds);
    const scoreBefore = scoreOn(afterPenalty, counting);
    const delta = await correctOneGolfersRound(page, state.eventId, CORRECTED_ROUND, afterPenalty, counting, -CORRECTION_STROKES);

    const read = await readContestLeaderboardOnceRebuilt(page, state.contestId, state.entryId, (rebuilt) => {
      expect(scoreOn(rebuilt, counting)).toBe(scoreBefore + delta);
    });
    expectCountingPicksExplainTheTotal(read);
    expect(read.entry.countingIds).toContain(counting);
    // The asymmetry this act exists for: the same size of correction, on a pick that counts,
    // moves the entry's total by its own change and nothing else.
    expect(read.entry.total).toBe(expectTotal(afterPenalty) + delta);
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

/**
 * The round that completes the card. Act 4 loaded round 1 and act 5 rounds 2 and 3, so on the
 * four-round tournament act 1 creates this is the one left — which act 6 reads off the event's
 * own schedule rather than trusting, and holds to exactly this round.
 */
const ACT_6_FINAL_ROUND = 4;

/**
 * Round 4's scores to par, in act 1's player order. Chosen so the final round changes which four
 * of the six picks count once more: the last live reading settlement freezes is then one this
 * act moved, not the one act 5 happened to leave behind, so "the frozen standing is the live
 * one" cannot pass by coincidence. No assertion is made against these numbers.
 */
const ACT_6_FINAL_ROUND_SCORES_TO_PAR = [2, -7, -8, 1, 0, 0];

// Act 6 is OUTSIDE the tagged describe for the reason acts 4 and 5 are, and further: it drives
// the event to a terminal status, which settles the contest and freezes its result for good.
test('act 6: completing the event settles the contest and freezes its standing at the last live reading', async ({ page }) => {
  test.setTimeout(240_000);
  const state = requireJourney();
  const { run } = state;
  const credentials = readAdminCredentials();

  await test.step('root admin signs in', async () => {
    await adminSignIn(page, credentials);
  });

  // #362 — left open across settlement, so the final result has to reach it by its own poll.
  const leaderboardTab = await test.step('open the leaderboard page while the contest is live', async () => {
    const tab = await openLeaderboardTab(page, run.leagueCode, state.contestId);
    await expect(tab.getByTestId(`contest-leaderboard-entry-${state.entryId}`)).toBeVisible();
    await expect(tab.getByTestId('contest-leaderboard-settled-note')).toHaveCount(0);
    await page.bringToFront();
    return tab;
  });

  await test.step(`the card is short exactly round ${ACT_6_FINAL_ROUND}`, async () => {
    // Which rounds are outstanding comes from the event's own schedule, not from a count this
    // file knows — and is then held to the single round this act has a plan for. If act 5 ever
    // stops leaving exactly one round unscored, this fails here rather than quietly going on to
    // "complete" a card that is still short.
    const scheduled = await readScheduledRoundNumbers(page, state.eventId);
    const read = await readContestLeaderboard(page, state.contestId, state.entryId);
    const unscored = scheduled.filter((roundNumber) => state.fieldEntryIds.some(
      (fieldEntryId) => !golferOn(read, fieldEntryId).rounds.has(roundNumber),
    ));
    expect(unscored).toEqual([ACT_6_FINAL_ROUND]);
  });

  await test.step(`load round ${ACT_6_FINAL_ROUND}, and every golfer has a score in every scheduled round`, async () => {
    await uploadRoundScores(
      page,
      state.eventId,
      ACT_6_FINAL_ROUND,
      state.fieldEntryIds.map((_, index) => ({
        playerName: `${run.playerNamePrefix} ${index + 1}`,
        strokes: PAR_PER_ROUND + ACT_6_FINAL_ROUND_SCORES_TO_PAR[index],
        scoreToPar: ACT_6_FINAL_ROUND_SCORES_TO_PAR[index],
      })),
    );
    for (const [index, fieldEntryId] of state.fieldEntryIds.entries()) {
      await expect(page.getByTestId(`root-admin-golf-scores-strokes-${fieldEntryId}`))
        .toHaveValue(String(PAR_PER_ROUND + ACT_6_FINAL_ROUND_SCORES_TO_PAR[index]));
    }

    // A complete card, stated as the event states it: every scheduled round scored for every
    // golfer in the field.
    const scheduled = await readScheduledRoundNumbers(page, state.eventId);
    await readContestLeaderboardOnceRebuilt(page, state.contestId, state.entryId, (read) => {
      for (const fieldEntryId of state.fieldEntryIds) {
        const golfer = golferOn(read, fieldEntryId);
        expect(
          [...golfer.rounds.keys()].sort((left, right) => left - right),
          `${golfer.name} has no score in every scheduled round`,
        ).toEqual(scheduled);
      }
    });
  });

  const finalLive = await test.step('this is the last live leaderboard before completion', async () => {
    const read = await readContestLeaderboard(page, state.contestId, state.entryId);
    expectCountingPicksExplainTheTotal(read);
    return read;
  });

  await test.step('move the tournament to completed, which is what settles its contests', async () => {
    // There is no settle operation to call: settlement is a consequence of the event reaching
    // COMPLETED (EventLifecycleService), so the admin's transition is the whole trigger.
    await page.goto(`/manage/sports/golf/events/${state.eventId}`);
    await page.getByTestId('root-admin-event-settings').click();
    await page.getByTestId('root-admin-sport-event-transition-COMPLETED').click();
    const moved = await submitAndRead<{ event: { status: string } }>(
      page,
      'root-admin-sport-event-transition-confirm',
      'POST',
      `/api/v1/events/${state.eventId}/transition`,
    );
    expect(moved.event.status).toBe('COMPLETED');
  });

  await test.step('the leaderboard page left open shows the final result without a reload', async () => {
    await leaderboardTab.bringToFront();
    await expect(leaderboardTab.getByTestId('contest-leaderboard-settled-note'))
      .toBeVisible({ timeout: LIVE_PAGE_TIMEOUT_MS });
    await expect(leaderboardTab.getByTestId(`contest-leaderboard-entry-${state.entryId}`)).toBeVisible();
    await leaderboardTab.close();
  });

  const settled = await test.step('the contest is settled, and its frozen standing is that last live reading', async () => {
    const managed = await readManagedContest(page, state.leagueId, state.contestId);
    expect(managed.contest.status).toBe('COMPLETED');

    const read = await readContestLeaderboard(page, state.contestId, state.entryId);
    // Settlement ranks with the same calculator over the same scores, so the standing it froze
    // has to be the live one it replaced — every field of it, not the total alone. None of these
    // is a number this file chose: each is the reading taken before the transition.
    //
    // On their own these would also pass if settlement had silently written nothing, because the
    // leaderboard falls back to computing live for an entry with no frozen standing. Two things
    // rule that out: the contest reaching COMPLETED above, which settlement only does after
    // upserting the standings, and the late correction in the last step, which a live entry's
    // total would follow. Those two steps are this one's control.
    expect(read.entry.total).toBe(finalLive.entry.total);
    expect(read.entry.position).toBe(finalLive.entry.position);
    expect(read.entry.displayPosition).toBe(finalLive.entry.displayPosition);
    expect(read.entry.countingPickLimit).toBe(finalLive.entry.countingPickLimit);
    expect(read.entry.scoredPickCount).toBe(finalLive.entry.scoredPickCount);
    // Finalized: the entry carries a position rather than sitting unranked, and the picks still
    // explain the frozen total, because no score has moved since settlement read them.
    expect(read.entry.position).not.toBeNull();
    expect(read.entry.displayPosition).not.toBeNull();
    expectCountingPicksExplainTheTotal(read);
    return read;
  });

  await test.step('the settled contest counts in its tour\'s cup: the Points race lists it as final, and the member\'s squad has points', async () => {
    await page.goto(`/league/${run.leagueCode}/championships/${state.championshipYear}/race/${state.tourId}`);
    await expect(page.getByTestId('points-race')).toBeVisible();
    await expect(page.getByTestId(`cup-contest-${state.contestId}`)).toContainText('Final');
    await expect(page.getByTestId('cup-standings')).toBeVisible();
    await expect(page.getByTestId('cup-race-chart')).toBeVisible();
  });

  await test.step('the settled contest counts in this year\'s league championship, which Championships opens on', async () => {
    // The championship counts a contest in the year it went final, which is now.
    await page.goto(`/league/${run.leagueCode}/championships`);
    await expect(page.getByTestId('championship')).toBeVisible();
    await expect(page.getByTestId('championship-progress')).toHaveText(/^[1-9]\d* contests? final$/);
    await expect(page.getByTestId('championship-standings')).toBeVisible();
  });

  await test.step('a late score correction moves the golfer and leaves the settled standing alone', async () => {
    const counting = bestOf(settled, settled.entry.countingIds);
    const scoreBefore = scoreOn(settled, counting);
    const delta = await correctOneGolfersRound(
      page,
      state.eventId,
      ACT_6_FINAL_ROUND,
      settled,
      counting,
      -CORRECTION_STROKES,
    );

    const read = await readContestLeaderboardOnceRebuilt(page, state.contestId, state.entryId, (rebuilt) => {
      // Act 5 proved this correction, on a counting pick, moves a live entry's total by its own
      // change. The golfer's event total moves here too, so the write plainly landed …
      expect(scoreOn(rebuilt, counting)).toBe(scoreBefore + delta);
    });
    // … and the settled entry does not move at all. That is the freeze: a provider correction
    // arriving after the result was called cannot rewrite who won.
    expect(read.entry.total).toBe(settled.entry.total);
    expect(read.entry.position).toBe(settled.entry.position);
    expect(read.entry.displayPosition).toBe(settled.entry.displayPosition);
    // `expectCountingPicksExplainTheTotal` is deliberately NOT re-applied here. The per-pick rows
    // stay the live read's, so the live counting picks now sum to something the frozen total no
    // longer matches — that divergence is the freeze working, and asserting the invariant would
    // assert the freeze had failed.
  });

  await test.step('root admin logs out', async () => {
    await logOut(page);
  });
});

/**
 * #749 — act 7's round-1 scores to par, by golfer index, in its two tournaments: different, so
 * each tournament's leaderboard reads differently. With the best four of six counting, the
 * entry is 1 under par in the first and 6 over in the second, and its contest total is the sum.
 */
const ACT_7_SCORES_TO_PAR: readonly (readonly number[])[] = [
  [-2, -1, 1, 1, 3, 4],
  [0, 1, 2, 3, 4, 5],
];
const ACT_7_EVENT_TOTALS: readonly number[] = [-1, 6];
const ACT_7_CONTEST_TOTAL = 5;

// Act 7 is outside the tagged describe too: it starts tournaments and writes scores.
test('act 7: a contest over two tournaments — the commissioner adds the second on the Events page, and the member\'s entry and the leaderboard switch between them', async ({ page }) => {
  test.setTimeout(300_000);
  const state = requireJourney();
  const { run } = state;
  const credentials = readAdminCredentials();
  const [firstName, secondName] = run.moreTournamentNames ?? [];
  if (!firstName || !secondName) {
    throw new Error('act 1 named no further tournaments for act 7');
  }
  const contestName = e2eName('Two Events', run.runId);

  // The same day a week out, morning and afternoon, so both are in one year whatever the date.
  const tournaments = await test.step('the root admin builds and releases two more tournaments on the tour, each with the six players a tier apiece', async () => {
    await adminSignIn(page, credentials);
    const day = addDays(new Date(), 7);
    const built: BuiltTournament[] = [];
    for (const [index, name] of [firstName, secondName].entries()) {
      const start = new Date(day);
      start.setHours(index === 0 ? 8 : 13, 0, 0, 0);
      built.push(await buildReleasedTournament(page, { runId: run.runId, tourId: state.tourId, name, start, playerIds: state.playerIds }));
    }
    await logOut(page);
    return built;
  });
  const [first, second] = tournaments;

  const contestId = await test.step('the commissioner creates a tiered contest on the first tournament', async () => {
    await adminSignIn(page, { identifier: run.commissioner.username, password: state.commissionerPassword });
    await page.goto(`/league/${run.leagueCode}/admin/contests/new`);
    const eventChoice = page.getByTestId(`contest-event-${first.eventId}`);
    await expect(eventChoice).toContainText(firstName);
    await eventChoice.click();
    await expect(eventChoice).toBeChecked();
    await page.getByTestId('contest-name').fill(contestName);
    await page.getByTestId('contest-tiered-picks-per-tier').fill('1');
    await page.getByTestId('contest-tiered-counted-scores').fill('4');
    const created = await submitAndRead<{ contest: { id: string } }>(
      page,
      'create-contest-submit',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contests`,
    );
    await expect(page.getByTestId('manage-contest-page')).toBeVisible();
    return created.contest.id;
  });

  await test.step('on the contest\'s Events page the commissioner adds the second tournament, and the contest lists both', async () => {
    await page.getByTestId('manage-contest-events-edit').click();
    await expect(page.getByTestId('contest-events-page')).toBeVisible();
    await expect(page.getByTestId('contest-events-chosen')).toContainText(firstName);
    await page.getByTestId(`contest-events-option-${second.eventId}`).check();
    await expect(page.getByTestId('contest-events-chosen')).toContainText(secondName);
    const saved = await submitAndRead<{ contest: { sportEvents: { sportEventId: string }[] } }>(
      page,
      'contest-events-save',
      'PUT',
      `/api/v1/leagues/${state.leagueId}/contest-management/contests/${contestId}/sport-events`,
    );
    expect(saved.contest.sportEvents.map((sportEvent) => sportEvent.sportEventId)).toEqual([first.eventId, second.eventId]);
    await expect(page.getByTestId('manage-contest-page')).toBeVisible();
  });

  await test.step('the commissioner opens the contest to the league and logs out', async () => {
    await page.getByTestId('contest-open-to-league').click();
    const opened = await submitAndRead<{ contest: { status: string } }>(
      page,
      'contest-open-confirm',
      'POST',
      `/api/v1/leagues/${state.leagueId}/contest-management/contests/${contestId}/open`,
    );
    expect(opened.contest.status).toBe('OPEN');
    await logOut(page);
  });

  const entryId = await test.step('the member enters, picks a golfer a tier for the first tournament and submits it', async () => {
    await adminSignIn(page, { identifier: run.member.username, password: state.memberPassword });
    await page.goto(`/league/${run.leagueCode}/contests/${contestId}`);
    const created = await submitAndRead<{ entry: { id: string } }>(
      page,
      'contest-board-create-entry',
      'POST',
      `/api/v1/contests/${contestId}/entries/me`,
    );
    // The entry opens on the contest's first tournament.
    await expect(page.getByTestId('contest-entry-event-switcher')).toHaveValue(first.eventId);
    await pickAndSubmitEvent(page, contestId, created.entry.id, first);
    return created.entry.id;
  });

  await test.step('back on the entry, the member switches to the second tournament, which is not submitted yet, and submits a roster for it', async () => {
    await page.goto(`/league/${run.leagueCode}/contests/${contestId}/entries/${entryId}`);
    const switcher = page.getByTestId('contest-entry-event-switcher');
    await expect(switcher.locator(`option[value="${first.eventId}"]`)).toContainText('Submitted');
    await expect(switcher.locator(`option[value="${second.eventId}"]`)).toContainText('Not submitted');
    await switcher.selectOption(second.eventId);
    await expect(switcher).toHaveValue(second.eventId);
    // The second tournament's field is its own: none of the first's picks are on it.
    await expect(page.getByTestId(`contest-entry-selected-${first.fieldEntryIds[0]}`)).toHaveCount(0);
    await pickAndSubmitEvent(page, contestId, entryId, second);
    await logOut(page);
  });

  await test.step('the root admin starts both tournaments and loads each one\'s round-1 scores', async () => {
    await adminSignIn(page, credentials);
    for (const [index, tournament] of tournaments.entries()) {
      await page.goto(`/manage/sports/golf/events/${tournament.eventId}`);
      await page.getByTestId('root-admin-event-settings').click();
      await page.getByTestId('root-admin-sport-event-transition-IN_PROGRESS').click();
      const moved = await submitAndRead<{ event: { status: string } }>(
        page,
        'root-admin-sport-event-transition-confirm',
        'POST',
        `/api/v1/events/${tournament.eventId}/transition`,
      );
      expect(moved.event.status).toBe('IN_PROGRESS');
      await uploadRoundScores(
        page,
        tournament.eventId,
        1,
        ACT_7_SCORES_TO_PAR[index].map((scoreToPar, golfer) => ({
          playerName: `${run.playerNamePrefix} ${golfer + 1}`,
          strokes: PAR_PER_ROUND + scoreToPar,
          scoreToPar,
        })),
      );
    }
    await logOut(page);
  });

  await test.step('the member\'s leaderboard switches between the tournaments, each with its own picks and total', async () => {
    await adminSignIn(page, { identifier: run.member.username, password: state.memberPassword });
    await page.goto(`/league/${run.leagueCode}/contests/${contestId}`);
    const switcher = page.getByTestId('contest-leaderboard-event-switcher');
    await expect(switcher).toBeVisible();
    for (const tournament of tournaments) {
      const response = await page.request.get(`/api/v1/contests/${contestId}/leaderboard`, {
        params: { sportEventId: tournament.eventId },
      });
      expect(response.ok(), `GET the leaderboard for ${tournament.eventId} answered ${response.status()}`).toBe(true);
      const board = (await response.json()) as {
        sportEventId: string;
        entries: Array<{
          entryId: string;
          totalScore: number | null;
          events: { sportEventId: string; totalScore: number | null }[];
          picks: { pickId: string }[];
        }>;
      };
      expect(board.sportEventId).toBe(tournament.eventId);
      const entry = board.entries.find((candidate) => candidate.entryId === entryId);
      // The contest total sums both tournaments whichever is shown; the picks are the shown one's.
      expect(entry?.totalScore).toBe(ACT_7_CONTEST_TOTAL);
      expect(entry?.events.map((result) => [result.sportEventId, result.totalScore])).toEqual(
        tournaments.map((each, eachIndex) => [each.eventId, ACT_7_EVENT_TOTALS[eachIndex]]),
      );

      await switcher.selectOption(tournament.eventId);
      await expect(switcher).toHaveValue(tournament.eventId);
      expect(entry?.picks).toHaveLength(PLAYER_COUNT);
      for (const pick of entry?.picks ?? []) {
        await expect(page.getByTestId(`contest-leaderboard-pick-${entryId}-${pick.pickId}`)).toBeVisible();
      }
      // On the page too: the contest total, and each tournament's place and score.
      await expect(page.getByTestId(`contest-leaderboard-total-${entryId}`)).toHaveText(`+${ACT_7_CONTEST_TOTAL}`);
      await expect(page.getByTestId(`contest-leaderboard-events-${entryId}`)).toHaveText(
        `${firstName}: 1, ${ACT_7_EVENT_TOTALS[0]} · ${secondName}: 1, +${ACT_7_EVENT_TOTALS[1]}`,
      );
    }
    await logOut(page);
  });
});

type BuiltTournament = { eventId: string; fieldEntryIds: string[] };

/**
 * #749 — act 1's tournament steps, condensed, for act 7's two further tournaments: create a
 * test tournament on the tour, load the six players, put one in each default tier, price
 * the field and release it. Act 1 proves each of these pages; this only uses them.
 */
async function buildReleasedTournament(
  page: Page,
  { runId, tourId, name, start, playerIds }: { runId: string; tourId: string; name: string; start: Date; playerIds: readonly string[] },
): Promise<BuiltTournament> {
  const { id: eventId } = await createTestEvent(page, { sportUrlSegment: 'golf', sportLeagueId: tourId, slotKind: 'TOURNAMENT', slotLabel: name, startsAt: start, name });

  await page.goto(`/manage/sports/golf/events/${eventId}/field`);
  await page.getByTestId('root-admin-event-field-add').click();
  await page.getByTestId('root-admin-event-field-add-search').fill(runId);
  for (const id of playerIds) {
    const candidate = page.getByTestId(`root-admin-event-field-add-candidate-${id}`);
    await candidate.click();
    await expect(candidate).toHaveAttribute('aria-pressed', 'true');
  }
  await submitAndRead(page, 'root-admin-event-field-add-modal-apply', 'POST', `/api/v1/events/${eventId}/participants`);
  await expect(page.getByTestId('root-admin-event-field-add-modal')).toBeHidden();

  const fieldResponse = await page.request.get(`/api/v1/events/${eventId}/participants`);
  expect(fieldResponse.ok(), `GET the field answered ${fieldResponse.status()}`).toBe(true);
  const field = (await fieldResponse.json()) as { participants: { id: string; participantId: string }[] };
  const fieldEntryIds = playerIds.map((playerId) => {
    const entry = field.participants.find((candidate) => candidate.participantId === playerId);
    if (!entry) {
      throw new Error(`player ${playerId} is not in the field of "${name}"`);
    }
    return entry.id;
  });

  await page.goto(`/manage/sports/golf/events/${eventId}/field`);
  for (const [index, entryId] of fieldEntryIds.entries()) {
    await correctFieldParticipant(page, eventId, entryId, { tierKey: `tier-${index + 1}`, seedNumber: index + 1 });
  }
  await page.getByTestId('root-admin-tier-auto-prices').click();
  await expect(page.getByTestId('root-admin-tier-auto-prices-preview')).toBeVisible();
  await submitAndRead(page, 'root-admin-tier-auto-prices-confirm', 'POST', `/api/v1/events/${eventId}/prices/auto-assign`);

  await page.goto(`/manage/sports/golf/events/${eventId}`);
  await page.getByTestId('root-admin-event-release-chip').click();
  await page.getByTestId('root-admin-sport-event-release').click();
  const released = await submitAndRead<{ event: { status: string } }>(
    page,
    'root-admin-sport-event-release-confirm',
    'POST',
    `/api/v1/events/${eventId}/release`,
  );
  expect(released.event.status).toBe('SCHEDULED');
  return { eventId, fieldEntryIds };
}

/**
 * #749 — picks one golfer from each tier of the tournament the entry page shows, sets the
 * tiebreaker and submits the entry for that tournament.
 */
async function pickAndSubmitEvent(page: Page, contestId: string, entryId: string, tournament: BuiltTournament) {
  for (const fieldEntryId of tournament.fieldEntryIds) {
    await expect(page.getByTestId(`contest-entry-participant-${fieldEntryId}`)).toBeVisible();
    await submitAndRead(page, `contest-entry-participant-${fieldEntryId}`, 'PUT', `/api/v1/selections/${contestId}/entries/${entryId}/picks/${fieldEntryId}`);
    await expect(page.getByTestId(`contest-entry-selected-${fieldEntryId}`)).toBeVisible();
  }
  await page.getByTestId('contest-entry-tiebreaker-select').selectOption({ index: 1 });
  await submitAndRead(
    page,
    'contest-entry-submit',
    'POST',
    `/api/v1/selections/${contestId}/entries/${entryId}/events/${tournament.eventId}/submit`,
  );
  await expect(page.getByTestId(`contest-board-entry-${entryId}`)).toBeVisible();
}

/**
 * #362 — how long a leaderboard page left open gets to catch up on its own: one 30-second poll,
 * of the contest to see a status change (which reads the leaderboard straight away) or of the
 * leaderboard to see a new round, with room to spare. Comfortably over one interval rather than
 * a sleep.
 */
const LIVE_PAGE_TIMEOUT_MS = 75_000;

/**
 * Opens the contest's leaderboard page in a second tab of the same signed-in context, so the
 * admin tab can drive the event while this one is left alone. Nothing here reloads it; the
 * caller asserts what the page should show on arrival and brings the admin tab back.
 */
async function openLeaderboardTab(page: Page, leagueCode: string, contestId: string): Promise<Page> {
  const tab = await page.context().newPage();
  await tab.goto(`/league/${leagueCode}/contests/${contestId}`);
  return tab;
}

/** The open leaderboard page has picked up `round`, and shows the entry with that round scored on each pick. */
async function expectLeaderboardPageShowsRound(tab: Page, entryId: string, pickIds: string[], round: number) {
  await tab.bringToFront();
  await expect(tab.getByTestId(`contest-leaderboard-round-header-${round}`))
    .toBeVisible({ timeout: LIVE_PAGE_TIMEOUT_MS });
  await expect(tab.getByTestId(`contest-leaderboard-entry-${entryId}`)).toBeVisible();
  // Rows start closed for anyone but their owner (#1739); once opened, a row stays open across polls.
  const toggle = tab.getByTestId(`contest-leaderboard-entry-toggle-${entryId}`);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  for (const pickId of pickIds) {
    await expect(tab.getByTestId(`contest-leaderboard-pick-round-${entryId}-${pickId}-${round}`)).not.toHaveText('—');
  }
}

/** Opens a DataGrid column's filter by its funnel's test id, types the term and applies it. */
async function filterGridText(page: Page, filterTestId: string, term: string) {
  await page.getByTestId(filterTestId).click();
  await page.getByTestId(`${filterTestId}-term`).fill(term);
  await page.getByTestId(`${filterTestId}-apply`).click();
}

async function expectListPageLoaded(page: Page, path: string, landmark: string, table: string) {
  await page.goto(path);
  await expect(page.getByTestId(landmark)).toBeVisible();
  // The table renders only once the page's query has settled without an error, so the
  // absence check below cannot pass merely because the page is still loading.
  await expect(page.getByTestId(table)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}


/** What act 5 reads off `getContestLeaderboard`; everything else in the body is unused here. */
type ContestLeaderboardBody = {
  countingRule: { count: number };
  participants: Array<{
    id: string;
    participant: { name: string };
    standing: { position: number | null; golf: { eventScoreToPar: number } | null } | null;
    rounds: Array<{ roundNumber: number; golf: { strokes: number; scoreToPar: number } | null }>;
  }>;
  entries: Array<{
    entryId: string;
    position: number | null;
    displayPosition: string | null;
    scoredPickCount: number;
    countingPickLimit: number;
    totalScore: number | null;
    picks: Array<{ pickId: string; sportEventParticipantId: string; isCounting: boolean; isDropped: boolean }>;
  }>;
};

/** One read of the leaderboard, reduced to what act 5 compares between reads. */
type LeaderboardRead = {
  /** N, as the contest's counting rule publishes it. */
  countingRuleCount: number;
  /** The entry under test, as the leaderboard ranks it. */
  entry: {
    total: number | null;
    position: number | null;
    displayPosition: string | null;
    scoredPickCount: number;
    countingPickLimit: number;
    /** Field-row ids of the picks that count toward the total, best first. */
    countingIds: string[];
    /** Field-row ids of the picks that are scored but dropped, best first. */
    droppedIds: string[];
    /** Every pick's own id, which the leaderboard page keys its rows by. */
    pickIds: string[];
  };
  /** Every field row the leaderboard published, by field-row id. */
  golfers: Map<string, {
    name: string;
    /** The golfer's event total under the contest's scoring definition; null while unscored. */
    score: number | null;
    position: number | null;
    rounds: Map<number, { strokes: number; scoreToPar: number }>;
  }>;
  /** Field-row ids in the order the event places them, best first; an unplaced row is left out. */
  placedOrder: string[];
};

/**
 * Reads the contest leaderboard until `expectations` hold of it. A write's boards are rebuilt in a
 * background job a moment after the write answers (#1463), so the read straight after a score
 * write can still be the board from before it, as a member's poll would be.
 */
async function readContestLeaderboardOnceRebuilt(
  page: Page,
  contestId: string,
  entryId: string,
  expectations: (read: LeaderboardRead) => void,
): Promise<LeaderboardRead> {
  const passed: LeaderboardRead[] = [];
  await expect(async () => {
    const read = await readContestLeaderboard(page, contestId, entryId);
    expectations(read);
    passed.push(read);
  }).toPass({ timeout: BOARD_REBUILD_TIMEOUT_MS });
  const rebuilt = passed.at(-1);
  if (!rebuilt) throw new Error('the leaderboard was never read');
  return rebuilt;
}

/** How long a read waits for the rebuild a write queued, well past the job runner's 10 s poll. */
const BOARD_REBUILD_TIMEOUT_MS = 30_000;

/**
 * Reads one entry's standing and the whole field off the contest leaderboard.
 *
 * `page.request`, not a `waitForResponse` handle: a handle does not survive the navigation each
 * upload step makes, and `.json()` on one that did not then fails with "Protocol error
 * (Network.getResponseBody)" — act 1's tiers step carries the full account. A GET shares the
 * browser context's cookies and needs no CSRF header.
 */
async function readContestLeaderboard(page: Page, contestId: string, entryId: string): Promise<LeaderboardRead> {
  const response = await page.request.get(`/api/v1/contests/${contestId}/leaderboard`);
  expect(response.ok(), `GET the leaderboard answered ${response.status()}`).toBe(true);
  const body = (await response.json()) as ContestLeaderboardBody;

  const standing = body.entries.find((candidate) => candidate.entryId === entryId);
  if (!standing) {
    throw new Error(`the leaderboard carries no standing for entry ${entryId}`);
  }
  const golfers: LeaderboardRead['golfers'] = new Map(
    body.participants.map((row) => [row.id, {
      name: row.participant.name,
      score: row.standing?.golf?.eventScoreToPar ?? null,
      position: row.standing?.position ?? null,
      rounds: new Map(
        row.rounds.flatMap((round) => (round.golf
          ? [[round.roundNumber, { strokes: round.golf.strokes, scoreToPar: round.golf.scoreToPar }] as const]
          : [])),
      ),
    }]),
  );

  return {
    countingRuleCount: body.countingRule.count,
    entry: {
      total: standing.totalScore,
      position: standing.position,
      displayPosition: standing.displayPosition,
      scoredPickCount: standing.scoredPickCount,
      countingPickLimit: standing.countingPickLimit,
      // The endpoint returns picks counting first and best first within that, so both lists
      // come back in merit order without this file re-deriving one.
      countingIds: standing.picks.filter((pick) => pick.isCounting).map((pick) => pick.sportEventParticipantId),
      droppedIds: standing.picks.filter((pick) => pick.isDropped).map((pick) => pick.sportEventParticipantId),
      pickIds: standing.picks.map((pick) => pick.pickId),
    },
    golfers,
    placedOrder: body.participants
      .filter((row) => row.standing?.position != null)
      .sort((left, right) => (left.standing?.position ?? 0) - (right.standing?.position ?? 0))
      .map((row) => row.id),
  };
}

/**
 * The leaderboard's own arithmetic, checked against itself on every read: the entry's total is
 * the sum of exactly the picks it says are counting, there are N of them, and every one of them
 * scores better than every pick it dropped.
 *
 * The last of those also pins which way "better" runs for GOLF_RELATIVE_TO_PAR_TOTAL — a lower
 * total — from the endpoint's own answer. Act 5's corrections are built as a penalty and a gain
 * in those terms, so this is the assertion that keeps that reading honest rather than assumed.
 */
function expectCountingPicksExplainTheTotal(read: LeaderboardRead): void {
  const counting = read.entry.countingIds.map((fieldEntryId) => scoreOn(read, fieldEntryId));
  const dropped = read.entry.droppedIds.map((fieldEntryId) => scoreOn(read, fieldEntryId));
  expect(counting).toHaveLength(read.entry.countingPickLimit);
  expect(dropped.length).toBeGreaterThan(0);
  expect(counting.reduce((sum, score) => sum + score, 0)).toBe(read.entry.total);
  expect(Math.max(...counting)).toBeLessThan(Math.min(...dropped));
}

/** The entry's total, which every act-5 step reads only after proving it is scored. */
function expectTotal(read: LeaderboardRead): number {
  const { total } = read.entry;
  if (total === null) {
    throw new Error('the entry has no total on the leaderboard');
  }
  return total;
}

function golferOn(read: LeaderboardRead, fieldEntryId: string) {
  const golfer = read.golfers.get(fieldEntryId);
  if (!golfer) {
    throw new Error(`the leaderboard published no field row ${fieldEntryId}`);
  }
  return golfer;
}

function scoreOn(read: LeaderboardRead, fieldEntryId: string): number {
  const golfer = golferOn(read, fieldEntryId);
  if (golfer.score === null) {
    throw new Error(`${golfer.name} has no event total on the leaderboard`);
  }
  return golfer.score;
}

function roundOn(read: LeaderboardRead, fieldEntryId: string, roundNumber: number) {
  const golfer = golferOn(read, fieldEntryId);
  const round = golfer.rounds.get(roundNumber);
  if (!round) {
    throw new Error(`${golfer.name} has no scored round ${roundNumber} on the leaderboard`);
  }
  return round;
}

/** Of these field rows, the one scoring worst — the highest total, per the direction above. */
function worstOf(read: LeaderboardRead, fieldEntryIds: readonly string[]): string {
  return [...fieldEntryIds].sort((left, right) => scoreOn(read, right) - scoreOn(read, left))[0];
}

/** Of these field rows, the one scoring best — the lowest total, per the direction above. */
function bestOf(read: LeaderboardRead, fieldEntryIds: readonly string[]): string {
  return [...fieldEntryIds].sort((left, right) => scoreOn(read, left) - scoreOn(read, right))[0];
}

/**
 * Loads one round of scores as the feed would send them: by participant id, through the test
 * event's golf score route (the CSV paste is gone, #2008). The golfers were created in the webapp,
 * so each is found on the field by its run-unique name here, in the test, and sent by id. Then the
 * results page is opened on that round, so the caller reads the write back in the UI.
 *
 * The round control is a radio group with no test id of its own, so the round is chosen by its
 * accessible name.
 */
async function uploadRoundScores(
  page: Page,
  eventId: string,
  round: number,
  rows: ReadonlyArray<{ playerName: string; strokes: number; scoreToPar: number }>,
): Promise<void> {
  const field = await page.request.get(`/api/v1/events/${eventId}/participants`);
  expect(field.ok(), `GET the field answered ${field.status()}`).toBe(true);
  const { participants } = (await field.json()) as { participants: Array<{ participantId: string; participant: { name: string } }> };
  const participantIdOf = (name: string) => {
    const row = participants.find((candidate) => candidate.participant.name === name);
    if (!row) throw new Error(`${name} is not on the field of event ${eventId}`);
    return row.participantId;
  };
  const response = await page.request.post(`/api/v1/events/${eventId}/rounds/${round}/golf-scores`, {
    headers: { 'x-csrf-token': await readCsrfToken(page) },
    data: {
      rows: rows.map((row) => ({
        participantId: participantIdOf(row.playerName),
        strokes: row.strokes,
        scoreToPar: row.scoreToPar,
        thru: 18,
        status: 'COMPLETED',
      })),
    },
  });
  expect(response.ok(), `POST round ${round}'s golf scores answered ${response.status()}`).toBe(true);

  await page.goto(`/manage/sports/golf/events/${eventId}/results`);
  await expect(page.getByTestId('root-admin-golf-tournament-scores-page')).toBeVisible();
  await page
    .getByRole('radiogroup', { name: 'Round' })
    .getByRole('radio', { name: new RegExp(`^Round ${round}\\b`) })
    .click();
}

/**
 * Moves one golfer's `roundNumber` by `strokes` — through the same score route, as a one-row
 * correction — and returns what that did to their score to par for the round. Both the row it
 * uploads and the change it reports are derived from the leaderboard read passed in, so the
 * caller compares the entry's total against a delta the API supplied.
 */
async function correctOneGolfersRound(
  page: Page,
  eventId: string,
  roundNumber: number,
  read: LeaderboardRead,
  fieldEntryId: string,
  strokes: number,
): Promise<number> {
  const golfer = golferOn(read, fieldEntryId);
  const before = roundOn(read, fieldEntryId, roundNumber);
  const after = { strokes: before.strokes + strokes, scoreToPar: before.scoreToPar + strokes };
  await uploadRoundScores(page, eventId, roundNumber, [{ playerName: golfer.name, ...after }]);
  // The round's own grid, re-read after the apply: the correction is in the golfer's row.
  await expect(page.getByTestId(`root-admin-golf-scores-strokes-${fieldEntryId}`))
    .toHaveValue(String(after.strokes));
  return after.scoreToPar - before.scoreToPar;
}

/** The event's scheduled round numbers, ascending: what a complete card has to cover. */
async function readScheduledRoundNumbers(page: Page, eventId: string): Promise<number[]> {
  const response = await page.request.get(`/api/v1/events/${eventId}/rounds`);
  expect(response.ok(), `GET the event's rounds answered ${response.status()}`).toBe(true);
  const { rounds } = (await response.json()) as { rounds: { roundNumber: number }[] };
  return rounds.map((round) => round.roundNumber).sort((left, right) => left - right);
}

/** The commissioner-managed view of a contest: its status and the configuration editor's values. */
async function readManagedContest(page: Page, leagueId: string, contestId: string): Promise<ManagedContestRead> {
  const response = await page.request.get(
    `/api/v1/leagues/${leagueId}/contest-management/contests/${contestId}`,
  );
  expect(response.ok(), `GET the managed contest answered ${response.status()}`).toBe(true);
  return (await response.json()) as ManagedContestRead;
}

type ManagedContestRead = {
  contest: {
    status: string;
    /** The stored rules, one shape per selection type (#93), with the configuration's ids. */
    configuration: { id: string; contestId: string } & Record<string, unknown>;
  };
};

/**
 * Writes the contest's configuration back exactly as it already is, and reports how the API
 * answered.
 *
 * Unchanged on purpose. Act 2 sends it twice — while the contest is a draft and after it is
 * opened to the league — and a request that alters nothing makes the second answer attributable
 * to the contest's status alone. The body carries only the three
 * fields the request schema defines, so the configuration's own `id` and `contestId` are
 * dropped rather than sent back as unexpected properties.
 *
 * The write goes through `page.request`, which shares the browser context's cookies, so it
 * needs the CSRF header the cookie session pairs with — a GET does not (see act 1's tiers step).
 */
async function putContestConfigurationUnchanged(
  page: Page,
  leagueId: string,
  contestId: string,
): Promise<{ status: number; errorCode: string | null }> {
  const { contest } = await readManagedContest(page, leagueId, contestId);
  // The rules as they are stored, less the configuration's own ids: the same rules sent back.
  const rules = (({ id: _id, contestId: _contestId, ...rest }: typeof contest.configuration) => rest)(
    contest.configuration,
  );
  const response = await page.request.put(
    `/api/v1/leagues/${leagueId}/contest-management/contests/${contestId}/configuration`,
    {
      headers: { 'x-csrf-token': await readCsrfToken(page) },
      data: rules,
    },
  );
  const body = (await response.json()) as { error?: { code?: string } };
  return { status: response.status(), errorCode: body.error?.code ?? null };
}
