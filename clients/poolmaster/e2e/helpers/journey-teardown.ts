import type { APIRequestContext } from '@playwright/test';
import { adminApiHeaders, attempt, expectOk, type AuthHeaders, type Log } from './admin-api';
import type { AdminCredentials } from './admin-session';

/**
 * #84, #280 — the golden journey's teardown (plans/130 §"Teardown"). One attempt's whole object
 * graph, removed through the API with the admin token, in dependency order:
 *
 *   league (its contest, entry, squads, memberships and invite link go with it)
 *   → tournament (its field, rounds and tiers go with it; refused while a contest references it,
 *     which is why the league goes first)
 *   → tour → players → commissioner → member.
 *
 * Tours and participants have no delete operation, so they are inactivated: out of every
 * active picker and identifiable by run id for the QA reset (#83). That, and the
 * `event_series` row creating a tournament makes, is the expected residue. (plans/147 removed
 * the season the journey used to create, and with it a step here.)
 *
 * Every lookup is by the attempt's run-unique names rather than ids captured during the test, so
 * an attempt that failed between a write and reading its response is still found and removed.
 * Every removal runs inside `attempt()`: a failure is logged as residue and the next one still
 * runs. Nothing here ever throws into the test.
 */

export type JourneyUser = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
};

/** Every name one attempt of the journey can create, all derived from its run id. */
export type JourneyRun = {
  runId: string;
  tourName: string;
  playerNamePrefix: string;
  tournamentName: string;
  commissioner: JourneyUser;
  member: JourneyUser;
  leagueName: string;
  leagueCode: string;
  contestName: string;
  squadName: string;
};

export async function removeJourneyRun(
  api: APIRequestContext,
  credentials: AdminCredentials,
  run: JourneyRun,
): Promise<void> {
  const log: Log = (message) => console.log(`[teardown ${run.runId}] ${message}`);
  const headers = await adminApiHeaders(api, credentials);
  if (!headers) {
    log(
      `admin login failed; nothing removed: league ${run.leagueCode}, tour "${run.tourName}" with its `
      + `tournament and players, users ${run.commissioner.username} and ${run.member.username}`,
    );
    return;
  }

  // The commissioner owns the league and the member's squad lives in it, and the contest in it
  // references the tournament: the league goes first.
  await attempt(log, `league ${run.leagueCode}`, () => removeLeague(api, headers, run.leagueCode, log));
  await attempt(log, `tournament "${run.tournamentName}"`, () => removeTournament(api, headers, run, log));
  const tourId = await findTourId(api, headers, run).catch((error: unknown) => {
    log(`could not look up tour "${run.tourName}": ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (tourId) {
    await attempt(log, `tour "${run.tourName}"`, () => inactivateTour(api, headers, tourId, run, log));
  } else {
    log(`tour "${run.tourName}" not found; no tour to inactivate`);
  }
  await attempt(log, `players "${run.playerNamePrefix} *"`, () => inactivatePlayers(api, headers, run, log));
  await attempt(log, `user ${run.commissioner.username}`, () => removeUser(api, headers, run.commissioner, log));
  await attempt(log, `user ${run.member.username}`, () => removeUser(api, headers, run.member, log));
}

// Lifted from the #278 plumbing probe, which first proved it. Shared with the squad-management
// teardown (#363).
export async function removeLeague(api: APIRequestContext, headers: AuthHeaders, leagueCode: string, log: Log) {
  const leagueByCode = `/api/v1/leagues/code/${leagueCode}`;
  const league = await api.get(leagueByCode, { headers });
  if (league.status() === 404) {
    log(`league ${leagueCode} was never created; nothing to remove`);
    return;
  }
  if (!league.ok()) {
    throw new Error(`resolve failed: ${league.status()}`);
  }
  const { league: { id: leagueId, isActive } } = (await league.json()) as {
    league: { id: string; isActive: boolean };
  };
  // Delete requires an inactive league; a retry of teardown may find it already inactive.
  if (isActive) {
    await expectOk(api.post(`/api/v1/leagues/${leagueId}/inactivate`, { headers }), 'inactivate league');
  }
  await expectOk(
    api.delete(`/api/v1/leagues/${leagueId}`, { headers, data: { leagueCode } }),
    'delete league',
  );
  const reread = await api.get(leagueByCode, { headers });
  log(reread.status() === 404
    ? `league ${leagueCode} removed with its contest, entries, squads and invite link (re-read 404)`
    : `league ${leagueCode} STILL PRESENT after delete (re-read ${reread.status()})`);
}

async function removeTournament(api: APIRequestContext, headers: AuthHeaders, run: JourneyRun, log: Log) {
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
    ? `tournament "${run.tournamentName}" removed with its field, rounds, scores and tiers (re-read 404)`
    : `tournament "${run.tournamentName}" STILL PRESENT after delete (re-read ${reread.status()})`);
}

async function findTourId(api: APIRequestContext, headers: AuthHeaders, run: JourneyRun): Promise<string | null> {
  const list = await expectOk(
    api.get('/api/v1/sport-leagues', { headers, params: { sport: 'GOLF' } }),
    'list tours',
  );
  const { sportLeagues } = (await list.json()) as { sportLeagues: { id: string; name: string }[] };
  return sportLeagues.find((candidate) => candidate.name === run.tourName)?.id ?? null;
}

async function inactivateTour(
  api: APIRequestContext,
  headers: AuthHeaders,
  tourId: string,
  run: JourneyRun,
  log: Log,
) {
  await expectOk(
    api.patch(`/api/v1/sport-leagues/${tourId}`, { headers, data: { isActive: false } }),
    'inactivate tour',
  );
  log(`tour "${run.tourName}" inactivated (no delete operation exists)`);
}

// An inactive player drops out of the active roster and the field search.
async function inactivatePlayers(api: APIRequestContext, headers: AuthHeaders, run: JourneyRun, log: Log) {
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

// Lifted from the #278 plumbing probe, which first proved it. Shared with the squad-management
// teardown (#363).
export async function removeUser(api: APIRequestContext, headers: AuthHeaders, created: JourneyUser, log: Log) {
  const search = await api.get('/api/v1/users/', { headers, params: { search: created.username } });
  if (!search.ok()) {
    throw new Error(`search failed: ${search.status()}`);
  }
  const { users } = (await search.json()) as { users: { id: string; username: string }[] };
  const user = users.find((candidate) => candidate.username === created.username);
  if (!user) {
    log(`user ${created.username} was never created; nothing to remove`);
    return;
  }
  await expectOk(api.post(`/api/v1/users/${user.id}/disable`, { headers }), 'disable user');
  await expectOk(
    api.delete(`/api/v1/users/${user.id}`, { headers, data: { email: created.email } }),
    'delete user',
  );
  const reread = await api.get(`/api/v1/users/${user.id}`, { headers });
  log(reread.status() === 404
    ? `user ${created.username} removed (re-read 404)`
    : `user ${created.username} STILL PRESENT after delete (re-read ${reread.status()})`);
}
