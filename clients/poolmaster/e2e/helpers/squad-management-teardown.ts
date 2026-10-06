import type { APIRequestContext } from '@playwright/test';
import { adminApiHeaders, attempt, type Log } from './admin-api';
import type { AdminCredentials } from './admin-session';
import { removeLeague, removeUser, type JourneyUser } from './journey-teardown';

/**
 * #363 — the squad-management spec's teardown, with the journey's discipline
 * (`journey-teardown.ts`): everything is found by the attempt's run-unique names, every removal
 * runs inside `attempt()`, and nothing here ever throws into the test.
 *
 * The league goes first and takes the squad, its owner invitation and every membership with it
 * (the spec normally deletes the squad itself; a failed attempt may leave it). Then the three
 * users the attempt registered.
 */

/** Every name one attempt of the squad-management spec can create, all derived from its run id. */
export type SquadManagementRun = {
  runId: string;
  commissioner: JourneyUser;
  member: JourneyUser;
  coOwner: JourneyUser;
  leagueName: string;
  leagueCode: string;
  squadName: string;
  renamedSquadName: string;
};

export async function removeSquadManagementRun(
  api: APIRequestContext,
  credentials: AdminCredentials,
  run: SquadManagementRun,
): Promise<void> {
  const log: Log = (message) => console.log(`[teardown ${run.runId}] ${message}`);
  const headers = await adminApiHeaders(api, credentials);
  if (!headers) {
    log(
      `admin login failed; nothing removed: league ${run.leagueCode}, users `
      + `${run.commissioner.username}, ${run.member.username} and ${run.coOwner.username}`,
    );
    return;
  }

  await attempt(log, `league ${run.leagueCode}`, () => removeLeague(api, headers, run.leagueCode, log));
  for (const user of [run.commissioner, run.member, run.coOwner]) {
    await attempt(log, `user ${user.username}`, () => removeUser(api, headers, user, log));
  }
}
