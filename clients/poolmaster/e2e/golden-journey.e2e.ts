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
 * #84, #280 — the golden journey (plans/130 §"Phase 2 — the journey suite"): the root admin
 * builds a golf catalog (act 1), a brand-new commissioner runs a league and a contest on it
 * (act 2), a brand-new member joins by invite link and enters (act 3), the root admin scores the
 * event and reads every role's writes back (act 4), further rounds of scores move the contest
 * leaderboard (act 5, #326), and completing the event settles the contest (act 6). Acts 4-6 also
 * keep the leaderboard page open across each change and assert it follows without a reload
 * (#362).
 *
 * Shape: one `test()` per act in a serial file. Tags select tests, not steps (plans/130 §"What
 * act 1 found when it ran"), so acts 1-3, which run post-deploy, sit in a describe tagged
 * `@smoke`, and acts 4-6, which do not, sit outside it — a tag cannot be removed from a test
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
  test('act 1: the root admin builds a golf catalog — tour, six players, a tournament, its field and tiers — and releases it', async ({ page }) => {
    test.setTimeout(180_000);
    const credentials = readAdminCredentials();
    admin = credentials;

    // Inside the test body, not at module load: a retry re-imports this module in a new worker
    // and must get its own id rather than collide with its first attempt.
    const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
    const run: JourneyRun = {
      runId,
      tourName: `E2E Tour ${runId}`,
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
      await expect(page).toHaveURL(/\/manage\/leagues$/);
      await expect(page.getByTestId('root-admin-manage-menu-golf')).toBeVisible();
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

    // plans/147 — a tournament is one year's edition on a tour; there is no season to create.
    const eventId = await test.step('create a tournament on the tour, in its start year', async () => {
      const now = new Date();
      const start = addDays(now, 7);
      start.setHours(8, 0, 0, 0);
      await page.goto('/manage/golf/tournaments/new');
      await page.getByTestId('root-admin-golf-tournament-create-tour').selectOption(tourId);
      await page.getByTestId('root-admin-golf-tournament-create-event-year').fill(String(start.getFullYear()));
      await page.getByTestId('root-admin-golf-tournament-create-name').fill(run.tournamentName);
      await page.getByTestId('root-admin-golf-tournament-create-start').fill(dateTimeInput(start));
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

    // #431 — a new tournament is a draft commissioners can't see. Act 2 can only create a
    // contest on one that is released, has a field, and has not started (`contestEligible`).
    const firstFieldEntryId = journey.fieldEntryIds[0];
    await test.step('release the tournament for contests, which locks its tiers', async () => {
      await page.goto(`/manage/golf/tournaments/${eventId}`);
      await expect(page.getByTestId('root-admin-golf-tournament-release')).toBeEnabled();
      await page.getByTestId('root-admin-golf-tournament-release').click();
      await expect(page.getByTestId('root-admin-golf-tournament-release-modal')).toBeVisible();
      const released = await submitAndRead<{ event: { status: string } }>(
        page,
        'root-admin-golf-tournament-release-confirm',
        'POST',
        `/api/v1/events/${eventId}/release`,
      );
      expect(released.event.status).toBe('SCHEDULED');
      await expect(page.getByTestId('root-admin-golf-tournament-release')).toHaveCount(0);

      await page.goto(`/manage/golf/tournaments/${eventId}/tiers`);
      await expect(page.getByTestId('root-admin-golf-tiers-locked')).toBeVisible();
      await expect(page.getByTestId(`root-admin-golf-tier-move-${firstFieldEntryId}`)).toBeDisabled();
    });

    await test.step('root admin logs out', async () => {
      await logOut(page);
    });
  });

  test('act 2: a new commissioner creates a league and a draft contest on the catalog, opens it to the league, then hands out a join link', async ({ page }) => {
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
      await expect(page.getByTestId('league-home-identity-name')).toHaveText(run.leagueName);
    });

    await test.step('create a contest on act 1\'s tournament: one pick per tier on six tiers, counted 4, one entry per team', async () => {
      // Contest setup lives in Commissioner tools, reached from the league menu.
      await page.getByTestId('league-menu-commissioner-tools').click();
      await page.getByTestId('commissioner-tools-menu-contests').click();
      await expect(page.getByTestId('manage-contests-page')).toBeVisible();
      await page.getByTestId('manage-contests-create-link').click();
      await expect(page.getByTestId('create-contest-page')).toBeVisible();
      // The picker lists every contest-eligible golf event on the platform, QA's whole catalog
      // included, so the run's own tournament is chosen by its id and checked by its name.
      const picker = page.getByTestId('contest-sport-event');
      await expect(picker.locator(`option[value="${state.eventId}"]`)).toContainText(run.tournamentName);
      await picker.selectOption(state.eventId);
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
      await expect(page.getByTestId('contest-manage-readonly-note')).toBeVisible();
      await expect(page.getByTestId('contest-open-to-league')).toHaveCount(0);

      const refused = await putContestConfigurationUnchanged(page, state.leagueId, state.contestId);
      expect(refused.status, `PUT the contest configuration answered ${refused.status}`).toBe(409);
      // The documented code, not a generic failure. The sentence that comes with it is
      // deliberately not asserted: the code is the contract, the prose is not.
      expect(refused.errorCode).toBe('CONTEST_CONFIGURATION_LOCKED');
    });

    await test.step('the contest is on the board with no entries, and on the league\'s contest list', async () => {
      await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
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

    await test.step('generate the join URL in Commissioner tools › Invites, and see it pending', async () => {
      // Inviting members lives in Commissioner tools, beside the invites still pending.
      await page.goto(`/league/${run.leagueCode}/admin/invites`);
      await page.getByTestId('league-open-invite-members').click();
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
      await page.keyboard.press('Escape');
      await expect(page.getByTestId(`league-invitation-${created.invitation.id}`)).toContainText('Join link');
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
          'POST',
          `/api/v1/selections/${state.contestId}/pick`,
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
        `/api/v1/selections/${state.contestId}/entries/${state.entryId}/submit`,
      );
    });

    await test.step('the entry is on the board as the member\'s own', async () => {
      await expect(page.getByTestId('contest-board')).toBeVisible();
      await expect(page.getByTestId(`contest-board-entry-${state.entryId}`)).toBeVisible();
      await expect(page.getByTestId(`contest-board-entry-spotlight-${state.entryId}`)).toBeVisible();
      await expect(page.getByTestId(`contest-board-entry-status-${state.entryId}`)).toHaveCount(0);
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
      await page.getByTestId('contest-menu-entries').click();
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
  // The leaderboard page left open across the start waits out one of its own polls.
  test.setTimeout(240_000);
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

  // #362 — opened before play, as a member watching for the start would have it. The contest is
  // still open, so the leaderboard read refuses it and the page shows its error state.
  const leaderboardTab = await test.step('open the leaderboard page before the event starts', async () => {
    const tab = await openLeaderboardTab(page, run.leagueCode, state.contestId);
    await expect(tab.getByTestId('contest-leaderboard-error-CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN')).toBeVisible();
    await page.bringToFront();
    return tab;
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

  await test.step('the leaderboard page opened before the start goes live without a reload', async () => {
    // The browser reproduction of #362: before the fix this page kept the contest status it
    // loaded with and never fetched the leaderboard again.
    await leaderboardTab.bringToFront();
    await expect(leaderboardTab.getByTestId(`contest-leaderboard-entry-${state.entryId}`))
      .toBeVisible({ timeout: LIVE_PAGE_TIMEOUT_MS });
    await expect(leaderboardTab.getByTestId('contest-leaderboard-error-CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN'))
      .toHaveCount(0);
    await leaderboardTab.close();
  });

  await test.step('the member\'s picks are revealed on the board and the leaderboard carries a score', async () => {
    await page.goto(`/league/${run.leagueCode}/contests/${state.contestId}`);
    await page.getByTestId(`contest-board-toggle-${state.entryId}`).click();
    for (const playerId of state.playerIds) {
      await expect(
        page.getByTestId(`contest-entry-pick-${state.entryId}-${playerId}`),
      ).toBeVisible();
    }
    // The board shows picks and never scores (#111). The leaderboard page rendering the entry
    // is asserted in the step above; this read checks every golfer has a round-1 score.
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

      const read = await readContestLeaderboard(page, state.contestId, state.entryId);
      expectCountingPicksExplainTheTotal(read);
      // What a leaderboard that tracks scoring has to change when a round lands, none of it a
      // number this file chose: the entry's total, the order the field is placed in, and which
      // of the entry's picks count.
      expect(read.entry.total).not.toBe(before.entry.total);
      expect(read.placedOrder).not.toEqual(before.placedOrder);
      expect([...read.entry.countingIds].sort()).not.toEqual([...before.entry.countingIds].sort());
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

    const read = await readContestLeaderboard(page, state.contestId, state.entryId);
    expectCountingPicksExplainTheTotal(read);
    // The write landed — the golfer's own event total moved by exactly the round's change …
    expect(scoreOn(read, dropped)).toBe(scoreBefore + delta);
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

    const read = await readContestLeaderboard(page, state.contestId, state.entryId);
    expectCountingPicksExplainTheTotal(read);
    expect(scoreOn(read, counting)).toBe(scoreBefore + delta);
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
    const read = await readContestLeaderboard(page, state.contestId, state.entryId);
    for (const fieldEntryId of state.fieldEntryIds) {
      const golfer = golferOn(read, fieldEntryId);
      expect(
        [...golfer.rounds.keys()].sort((left, right) => left - right),
        `${golfer.name} has no score in every scheduled round`,
      ).toEqual(scheduled);
    }
  });

  const finalLive = await test.step('this is the last live leaderboard before completion', async () => {
    const read = await readContestLeaderboard(page, state.contestId, state.entryId);
    expectCountingPicksExplainTheTotal(read);
    return read;
  });

  await test.step('move the tournament to completed, which is what settles its contests', async () => {
    // There is no settle operation to call: settlement is a consequence of the event reaching
    // COMPLETED (EventLifecycleService), so the admin's transition is the whole trigger.
    await page.goto(`/manage/golf/tournaments/${state.eventId}`);
    await page.getByTestId('root-admin-golf-tournament-transition-COMPLETED').click();
    const moved = await submitAndRead<{ event: { status: string } }>(
      page,
      'root-admin-golf-tournament-transition-confirm',
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

    const read = await readContestLeaderboard(page, state.contestId, state.entryId);
    // Act 5 proved this correction, on a counting pick, moves a live entry's total by its own
    // change. The golfer's event total moves here too, so the write plainly landed …
    expect(scoreOn(read, counting)).toBe(scoreBefore + delta);
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
  await tab.goto(`/league/${leagueCode}/contests/${contestId}/leaderboard`);
  return tab;
}

/** The open leaderboard page has picked up `round`, and shows the entry with that round scored on each pick. */
async function expectLeaderboardPageShowsRound(tab: Page, entryId: string, pickIds: string[], round: number) {
  await tab.bringToFront();
  await expect(tab.getByTestId(`contest-leaderboard-round-header-${round}`))
    .toBeVisible({ timeout: LIVE_PAGE_TIMEOUT_MS });
  await expect(tab.getByTestId(`contest-leaderboard-entry-${entryId}`)).toBeVisible();
  for (const pickId of pickIds) {
    await expect(tab.getByTestId(`contest-leaderboard-pick-round-${entryId}-${pickId}-${round}`)).not.toHaveText('—');
  }
}

async function expectListPageLoaded(page: Page, path: string, landmark: string, table: string) {
  await page.goto(path);
  await expect(page.getByTestId(landmark)).toBeVisible();
  // The table renders only once the page's query has settled without an error, so the
  // absence check below cannot pass merely because the page is still loading.
  await expect(page.getByTestId(table)).toBeVisible();
  await expect(page.getByTestId('shared-error-state')).toHaveCount(0);
  await expect(page.getByTestId('shared-forbidden-state')).toHaveCount(0);
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

/** What act 5 reads off `getGolfContestLeaderboard`; everything else in the body is unused here. */
type GolfContestLeaderboardBody = {
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
    golf: { totalScoreToPar: number | null } | null;
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
 * Reads one entry's standing and the whole field off the contest leaderboard.
 *
 * `page.request`, not a `waitForResponse` handle: a handle does not survive the navigation each
 * upload step makes, and `.json()` on one that did not then fails with "Protocol error
 * (Network.getResponseBody)" — act 1's tiers step carries the full account. A GET shares the
 * browser context's cookies and needs no CSRF header.
 */
async function readContestLeaderboard(page: Page, contestId: string, entryId: string): Promise<LeaderboardRead> {
  const response = await page.request.get(`/api/v1/contests/${contestId}/golf/leaderboard`);
  expect(response.ok(), `GET the leaderboard answered ${response.status()}`).toBe(true);
  const body = (await response.json()) as GolfContestLeaderboardBody;

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
      total: standing.golf?.totalScoreToPar ?? null,
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
 * Loads one round of scores the way an admin does: pick the round, paste the CSV, preview, apply.
 *
 * The round control is a radio group with no test id of its own, so the round is chosen by its
 * accessible name. The panel is keyed by round, so it is remounted by that click and the paste
 * has to follow it, never precede it.
 */
async function uploadRoundScores(
  page: Page,
  eventId: string,
  round: number,
  rows: ReadonlyArray<{ playerName: string; strokes: number; scoreToPar: number }>,
): Promise<void> {
  await page.goto(`/manage/golf/tournaments/${eventId}/scores`);
  await expect(page.getByTestId('root-admin-golf-tournament-scores-page')).toBeVisible();
  await page
    .getByRole('radiogroup', { name: 'Round' })
    .getByRole('radio', { name: new RegExp(`^Round ${round}\\b`) })
    .click();
  await page.getByTestId('root-admin-golf-scores-upload-textarea').fill([
    'externalId,playerName,strokes,scoreToPar,thru,status',
    // No externalId: these golfers were created in the webapp and have none, so each row
    // resolves on its run-unique name, as act 4's round-1 upload does.
    ...rows.map((row) => `,${row.playerName},${row.strokes},${row.scoreToPar},18,COMPLETED`),
  ].join('\n'));
  await page.getByTestId('root-admin-golf-scores-upload-preview').click();
  await expect(page.getByTestId('root-admin-golf-scores-upload-preview-result')).toBeVisible();
  await submitAndRead(
    page,
    'root-admin-golf-scores-upload-apply',
    'POST',
    `/api/v1/events/${eventId}/rounds/${round}/golf-scores`,
  );
}

/**
 * Moves one golfer's `roundNumber` by `strokes` — through the same upload panel, as a one-row
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
    configuration: {
      maxEntriesPerSquad?: number | null;
      picksPerTier: number;
      countedScores: number;
    };
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
  const { maxEntriesPerSquad, picksPerTier, countedScores } = contest.configuration;
  const response = await page.request.put(
    `/api/v1/leagues/${leagueId}/contest-management/contests/${contestId}/configuration`,
    {
      headers: { 'x-csrf-token': await readCsrfToken(page) },
      data: {
        ...(maxEntriesPerSquad === undefined ? {} : { maxEntriesPerSquad }),
        picksPerTier,
        countedScores,
      },
    },
  );
  const body = (await response.json()) as { error?: { code?: string } };
  return { status: response.status(), errorCode: body.error?.code ?? null };
}

/** The CSRF token the session issued, which a state-changing request has to echo in a header. */
async function readCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'poolmaster_csrf');
  if (!csrf) {
    throw new Error('the session carries no poolmaster_csrf cookie, so no write can be signed');
  }
  return csrf.value;
}
