import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { adminSignIn, readAdminCredentials, type AdminCredentials } from './helpers/admin-session';
import { submitAndRead } from './helpers/browser-writes';
import { removeSquadManagementRun, type SquadManagementRun } from './helpers/squad-management-teardown';
import { GENERATED_PASSWORD_PREFIX } from './helpers/constants';
import { registerFreshUser } from './helpers/user-session';

/**
 * #363 — squad management against the real API (plans/core-squad-management-e2e.md): the owner
 * renames their squad, changes its icon and brings in a co-owner by invite code; the
 * commissioner inactivates it; the root admin deletes it.
 *
 * Its own file, not a seventh act of the golden journey: deleting a squad deletes its contest
 * entries, which the journey's later acts score and settle, and none of this needs a golf
 * catalog. Untagged, so it runs pre-merge against the local stack only and never writes to QA.
 *
 * Each role keeps its own browser context for the whole test. A user registered here never
 * learns their password (`registerFreshUser` discards it), so a role signs in once and stays
 * signed in rather than signing out and back in.
 *
 * The journey's rules for a shared database hold here too: every name carries a per-attempt run
 * id, the test asserts only the presence of what it created, and teardown removes each attempt's
 * league and users through the API in `afterAll`, whatever the outcome.
 *
 * Where each action lives, as found by running it:
 * - rename, icon and co-owner invitation: the owner's My Team page;
 * - inactivate: the commissioner's squad list (`/league/:code/teams`). Only a commissioner or
 *   root admin may inactivate (#219);
 * - delete: root admin only, and only once the squad is inactive. The server answers a
 *   commissioner with 403, so the root admin deletes it from the squad's Team Home.
 */

const RENAMED_ICON = { key: 'HELMET_BOLT_MIDNIGHT', label: 'Helmet Bolt Midnight' } as const;

test.use({ actionTimeout: 20_000 });

let admin: AdminCredentials | undefined;
// Every attempt this worker made, recorded before its first write: each one is torn down,
// success or not, by this worker's `afterAll`.
const runs: SquadManagementRun[] = [];

test.afterAll(async ({ playwright }, testInfo) => {
  if (!admin || runs.length === 0) {
    return;
  }

  let api: APIRequestContext | undefined;
  try {
    api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
    for (const run of runs) {
      try {
        await removeSquadManagementRun(api, admin, run);
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

test('an owner renames their squad, changes its icon and adds a co-owner by invite code; the commissioner inactivates it and the root admin deletes it', async ({ browser, page }) => {
  test.setTimeout(180_000);
  const credentials = readAdminCredentials();
  admin = credentials;

  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const user = (role: string, label: string) => ({
    username: `e2e-${role}-${runId}`,
    // RFC 2606 reserves .invalid, so nothing sent to these can reach a real mailbox.
    email: `e2e-${role}-${runId}@e2e.invalid`,
    firstName: 'E2E',
    lastName: `${label} ${runId}`,
  });
  const run: SquadManagementRun = {
    runId,
    commissioner: user('sc', 'Commissioner'),
    // Neither label contains the other, so a name check on one can never pass on the other.
    member: user('sm', 'Founder'),
    // Brand new on purpose: an invitation to an address that already has an account is accepted
    // at once, with no invite code to follow.
    coOwner: user('so', 'CoOwner'),
    leagueName: `E2E Squads League ${runId}`,
    leagueCode: `E2ES${runId.toUpperCase()}`,
    squadName: `E2E Squad ${runId}`,
    renamedSquadName: `E2E Renamed ${runId}`,
  };
  // Recorded before anything is created, so a failure on the first write is still torn down.
  runs.push(run);
  console.log(
    `[squads ${runId}] league=${run.leagueCode} `
    + `users=${run.commissioner.username},${run.member.username},${run.coOwner.username}`,
  );

  const contexts: BrowserContext[] = [];
  const newRolePage = async (): Promise<Page> => {
    const context = await browser.newContext();
    contexts.push(context);
    return context.newPage();
  };

  try {
    const commissioner = page;
    let leagueId = '';
    let joinUrl = '';
    let squadId = '';
    let inviteCode = '';

    await test.step('a fresh commissioner registers, creates a league and generates a join URL', async () => {
      await commissioner.goto('/');
      await commissioner.getByTestId('auth-mode-register').click();
      await registerFreshUser(commissioner, run.commissioner);
      await expect(commissioner.getByTestId('authenticated-landing')).toBeVisible();

      await commissioner.getByTestId('welcome-create-league').click();
      // Code before name, as in the journey: a typed code is never replaced by the suggestion
      // the name field makes when it loses focus.
      await commissioner.getByTestId('create-league-code').fill(run.leagueCode);
      await commissioner.getByTestId('create-league-name').fill(run.leagueName);
      await commissioner.getByTestId('create-league-next').click();
      const created = await submitAndRead<{ league: { id: string } }>(
        commissioner,
        'create-league-submit',
        'POST',
        '/api/v1/leagues',
      );
      leagueId = created.league.id;
      await expect(commissioner.getByTestId('league-home')).toBeVisible();

      // #221 — inviting members lives on Teams and Owners, with the roster.
      await commissioner.goto(`/league/${run.leagueCode}/teams`);
      await commissioner.getByTestId('league-open-invite-members').click();
      const invitation = await submitAndRead<{ invitation: { inviteCode: string } }>(
        commissioner,
        'league-create-join-url',
        'POST',
        `/api/v1/leagues/${leagueId}/invite-link`,
      );
      const joinUrlField = commissioner.getByTestId('league-join-url');
      await expect(joinUrlField).toHaveValue(new RegExp(`/invite/${invitation.invitation.inviteCode}$`));
      joinUrl = await joinUrlField.inputValue();
      await commissioner.keyboard.press('Escape');
    });

    const owner = await newRolePage();

    await test.step('a fresh member joins by the link and names their squad', async () => {
      await owner.goto(joinUrl);
      await owner.getByTestId('invite-create-account').click();
      const memberId = await registerFreshUser(owner, run.member);
      await expect(owner.getByTestId('join-league-page')).toBeVisible();
      await owner.getByTestId('join-league-team-name').fill(run.squadName);
      await owner.getByTestId('join-league-team-icon-CAPTAIN_SMILE_OCEAN').click();
      await owner.getByTestId('invite-accept').click();
      await expect(owner.getByTestId('league-home')).toBeVisible();

      const squads = await owner.request.get(`/api/v1/leagues/${leagueId}/squads/`);
      expect(squads.ok(), `GET the league's squads answered ${squads.status()}`).toBe(true);
      const { squads: list } = (await squads.json()) as {
        squads: { id: string; name: string; members?: { userId: string }[] }[];
      };
      const mine = list.find((squad) => squad.members?.some((member) => member.userId === memberId));
      expect(mine?.name).toBe(run.squadName);
      squadId = mine?.id ?? '';
    });

    await test.step('the owner renames the squad, and the new name shows on My Team and the squad list', async () => {
      await owner.goto(`/league/${run.leagueCode}/team`);
      await expect(owner.getByTestId('my-team-details-tile')).toContainText(run.squadName);
      await owner.getByTestId('my-team-open-name').click();
      await owner.getByTestId('my-team-name').fill(run.renamedSquadName);
      const renamed = await submitAndRead<{ squad: { id: string; name: string } }>(
        owner,
        'my-team-save',
        'PATCH',
        `/api/v1/leagues/${leagueId}/squads/${squadId}`,
      );
      expect(renamed.squad.name).toBe(run.renamedSquadName);
      await expect(owner.getByTestId('my-team-details-tile')).toContainText(run.renamedSquadName);

      await owner.goto(`/league/${run.leagueCode}/teams`);
      await expect(owner.getByTestId(`league-team-home-link-${squadId}`)).toHaveText(run.renamedSquadName);
    });

    await test.step(`the owner changes the icon to ${RENAMED_ICON.label}`, async () => {
      await owner.goto(`/league/${run.leagueCode}/team`);
      await owner.getByTestId('my-team-change-icon').click();
      await owner.getByTestId(`my-team-icon-${RENAMED_ICON.key}`).click();
      const updated = await submitAndRead<{ squad: { iconKey: string } }>(
        owner,
        'my-team-save-icon',
        'PATCH',
        `/api/v1/leagues/${leagueId}/squads/${squadId}`,
      );
      expect(updated.squad.iconKey).toBe(RENAMED_ICON.key);
      await expect(owner.getByTestId('my-team-current-icon-label')).toHaveText(RENAMED_ICON.label);
    });

    await test.step('the owner invites a co-owner by an address with no account, and gets a pending invite code', async () => {
      await owner.getByTestId('my-team-open-owners').click();
      await owner.getByTestId('my-team-owner-email').fill(run.coOwner.email);
      // The code is read from the response, never from an email: the same rule as the league
      // join link, since there is no inbox the suite can read.
      const created = await submitAndRead<{ invitation: { status: string; inviteCode: string } }>(
        owner,
        'my-team-owner-invite',
        'POST',
        `/api/v1/leagues/${leagueId}/squads/${squadId}/owner-invitations`,
      );
      expect(created.invitation.status).toBe('PENDING');
      expect(created.invitation.inviteCode).not.toBe('');
      inviteCode = created.invitation.inviteCode;
    });

    await test.step('the co-owner registers through the invite code and lands on the squad as their own', async () => {
      const coOwner = await newRolePage();
      await coOwner.goto(`/team-invite/${inviteCode}`);
      await expect(coOwner.getByTestId('team-invite-register-form')).toBeVisible();
      // No email field: the account takes the address the invitation was sent to.
      await coOwner.getByTestId('team-invite-register-first-name').fill(run.coOwner.firstName);
      await coOwner.getByTestId('team-invite-register-last-name').fill(run.coOwner.lastName);
      await coOwner.getByTestId('team-invite-register-username').fill(run.coOwner.username);
      await coOwner.getByTestId('team-invite-register-password').fill(
        `${GENERATED_PASSWORD_PREFIX}${randomBytes(12).toString('hex')}`,
      );
      const registered = await submitAndRead<{ user: { id: string; email: string } }>(
        coOwner,
        'team-invite-register-submit',
        'POST',
        '/api/v1/team-invitations/register',
      );
      expect(registered.user.email).toBe(run.coOwner.email);

      await expect(coOwner).toHaveURL(new RegExp(`/league/${run.leagueCode}/team$`));
      const details = coOwner.getByTestId('my-team-details-tile');
      await expect(details).toContainText(run.renamedSquadName);
      await expect(details).toContainText(run.coOwner.lastName);
      await expect(details).toContainText(run.member.lastName);
      await expect(coOwner.getByTestId('my-team-current-icon-label')).toHaveText(RENAMED_ICON.label);
    });

    await test.step('the commissioner inactivates the squad from the squad list', async () => {
      await commissioner.goto(`/league/${run.leagueCode}/teams`);
      await commissioner.getByTestId(`squad-actions-open-inactivate-${squadId}`).click();
      await submitAndRead(
        commissioner,
        `squad-actions-confirm-inactivate-${squadId}`,
        'POST',
        `/api/v1/leagues/${leagueId}/squads/${squadId}/inactivate`,
      );
      await expect(commissioner.getByTestId(`league-team-${squadId}`)).toContainText('Inactive');

      await commissioner.getByTestId(`league-team-home-link-${squadId}`).click();
      await expect(commissioner.getByTestId('my-team-lifecycle-status')).toHaveText('Inactive');
    });

    await test.step('the root admin deletes the inactive squad, and it is gone from the league', async () => {
      const rootAdmin = await newRolePage();
      await adminSignIn(rootAdmin, credentials);
      await rootAdmin.goto(`/league/${run.leagueCode}/teams/${squadId}`);
      await expect(rootAdmin.getByTestId('my-team-lifecycle-status')).toHaveText('Inactive');
      await rootAdmin.getByTestId('my-team-delete').click();
      await submitAndRead(
        rootAdmin,
        'my-team-confirm-delete',
        'DELETE',
        `/api/v1/leagues/${leagueId}/squads/${squadId}`,
      );

      // Deleting returns the root admin to the league, and the squad list no longer shows it.
      // The squad is this run's own, so its absence is a fact about it and nothing else.
      await expect(rootAdmin.getByTestId('league-home')).toBeVisible();
      await rootAdmin.goto(`/league/${run.leagueCode}/teams`);
      // A positive anchor first, so the absence is never read off a list that has not loaded:
      // the list has settled once it shows either some team or its empty state.
      await expect(
        rootAdmin.getByTestId('teams-page-teams-empty')
          .or(rootAdmin.locator('[data-testid^="league-team-home-link-"]'))
          .first(),
      ).toBeVisible();
      await expect(rootAdmin.getByTestId(`league-team-home-link-${squadId}`)).toHaveCount(0);

      const reread = await rootAdmin.request.get(`/api/v1/leagues/${leagueId}/squads/${squadId}`);
      expect(reread.status(), 'the deleted squad re-read').toBe(404);
      const squads = await rootAdmin.request.get(`/api/v1/leagues/${leagueId}/squads/`);
      expect(squads.ok(), `GET the league's squads answered ${squads.status()}`).toBe(true);
      const { squads: list } = (await squads.json()) as { squads: { id: string }[] };
      expect(list.map((squad) => squad.id)).not.toContain(squadId);
    });
  } finally {
    for (const context of contexts) {
      await context.close();
    }
  }
});
