import type { APIRequestContext } from '@playwright/test';
import { adminApiHeaders, attempt, expectOk, type AuthHeaders, type Log } from './admin-api';
import type { AdminCredentials } from './admin-session';
import { findSeededSportLeagueThroughApi } from './test-event';

/**
 * #84, #280 — the golden journey's teardown (plans/130 §"Teardown", deleted:
 * `git show 392c725:plans/130-e2e-browser-suite-evaluation.md`). One attempt's whole object
 * graph, removed through the API with the admin token, in dependency order:
 *
 *   league (its contest, entry, squads, memberships and invite link go with it)
 *   → each tournament's test slot (its event, field, rounds and tiers go with it, and so does
 *     every test participant no other field holds; refused while a contest references the event,
 *     which is why the league goes first)
 *   → any player left → commissioner → member.
 *
 * The tour is a seeded sport league (#2004), so it stays; only the run's own labelled test slots
 * go (#2075). The players are test participants (#2096), so the last slot takes them.
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

/**
 * The sports a journey builds its catalog in: the golden journey's golf, the racing journey's
 * auto racing (Formula 1), the basketball of the knockout and bracket journeys, and the pick'em
 * journey's American football.
 */
export type JourneySport = 'GOLF' | 'AUTO_RACING' | 'BASKETBALL' | 'FOOTBALL';

/**
 * Every name one attempt of a journey can create, all derived from its run id. The tour, players
 * and tournament are the sport's own words for a sport league, participants and an event: a
 * racing run's are a series, drivers and a race. Each tournament is on a test slot labelled with
 * its name.
 */
export type JourneyRun = {
  runId: string;
  sport: JourneySport;
  /** The seeded sport league the run plays in (#2004), by its URL segment; never removed. */
  tourUrlSegment: string;
  playerNamePrefix: string;
  tournamentName: string;
  /** Further tournaments on the same tour, such as the golden journey's multi-event contest's. */
  moreTournamentNames?: readonly string[];
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
      `admin login failed; nothing removed: league ${run.leagueCode}, the tournament's test slot on tour ${run.tourUrlSegment} `
      + `and its players, users ${run.commissioner.username} and ${run.member.username}`,
    );
    return;
  }

  // The commissioner owns the league and the member's squad lives in it, and the contest in it
  // references the tournament: the league goes first.
  await attempt(log, `league ${run.leagueCode}`, () => removeLeague(api, headers, run.leagueCode, log));
  await attempt(log, `test slots on tour ${run.tourUrlSegment}`, () => removeRunTestSlots(api, headers, run, log));
  // A test participant goes with the last test slot whose field held it; any left (made before a
  // slot was) go here.
  await attempt(log, `players "${run.playerNamePrefix} *"`, () => removePlayers(api, headers, run.playerNamePrefix, log));
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
  // A delete that answered but left the row is a failure, which attempt() logs as residue.
  if (reread.status() !== 404) throw new Error(`league ${leagueCode} STILL PRESENT after delete (re-read ${reread.status()})`);
  log(`league ${leagueCode} removed with its contest, entries, squads and invite link (re-read 404)`);
}

/** The run's own test slots, one per tournament, each labelled with its tournament's name. */
async function removeRunTestSlots(api: APIRequestContext, headers: AuthHeaders, run: JourneyRun, log: Log) {
  const { id: sportLeagueId } = await findSeededSportLeagueThroughApi(api, headers, run.sport, run.tourUrlSegment);
  const labels = new Set([run.tournamentName, ...(run.moreTournamentNames ?? [])]);
  const slots = (await listTestSlots(api, headers, sportLeagueId)).filter((slot) => slot.label !== null && labels.has(slot.label));
  if (slots.length === 0) {
    log(`no test slot on tour ${run.tourUrlSegment} is labelled with the run's tournaments; nothing to remove`);
    return;
  }
  for (const slot of slots) {
    const label = slot.label ?? slot.id;
    await attempt(log, `test slot "${label}"`, () => removeTestSlot(api, headers, sportLeagueId, slot.id, label, log));
  }
}

/** Every test slot of every Season of a sport league, as its Season list reads them. */
export async function listTestSlots(api: APIRequestContext, headers: AuthHeaders, sportLeagueId: string): Promise<Array<{ id: string; label: string | null }>> {
  const response = await expectOk(api.get(`/api/v1/sport-leagues/${sportLeagueId}/seasons`, { headers }), 'list Seasons');
  const { seasons } = (await response.json()) as {
    seasons: Array<{ phases: Array<{ competitions: Array<{ slots: Array<{ id: string; isTestData: boolean; label: string | null }> }> }> }>;
  };
  return seasons
    .flatMap((season) => season.phases.flatMap((phase) => phase.competitions.flatMap((competition) => competition.slots)))
    .filter((slot) => slot.isTestData);
}

/** Removes a test slot with its event and the test participants of its field that no other field holds (#2075). */
export async function removeTestSlot(api: APIRequestContext, headers: AuthHeaders, sportLeagueId: string, slotId: string, label: string, log: Log) {
  await expectOk(api.delete(`/api/v1/sport-leagues/${sportLeagueId}/test-slots/${slotId}`, { headers }), `delete test slot ${label}`);
  const remaining = await listTestSlots(api, headers, sportLeagueId);
  if (remaining.some((slot) => slot.id === slotId)) throw new Error(`test slot "${label}" STILL PRESENT after delete`);
  log(`test slot "${label}" removed with its event, field and the field's test participants no other field holds`);
}

/**
 * Every player named "<prefix> *", active or not: an earlier teardown made them inactive. Each is
 * refused while an event field still holds them, which is why the tournaments go first.
 */
export async function removePlayers(api: APIRequestContext, headers: AuthHeaders, playerNamePrefix: string, log: Log) {
  const list = await expectOk(
    api.get('/api/v1/participants', { headers, params: { q: playerNamePrefix } }),
    'search players',
  );
  const { participants } = (await list.json()) as { participants: { id: string; name: string }[] };
  const players = participants.filter((candidate) => candidate.name.startsWith(`${playerNamePrefix} `));
  if (players.length === 0) {
    log(`no players named "${playerNamePrefix} *"; nothing to remove`);
    return;
  }
  for (const player of players) {
    await attempt(log, `player "${player.name}"`, async () => {
      await expectOk(api.delete(`/api/v1/participants/${player.id}`, { headers }), `delete player ${player.name}`);
      log(`player "${player.name}" removed`);
    });
  }
}

/**
 * Disables and deletes a user a spec made (from the #278 plumbing probe; shared with the
 * squad-management teardown, #363). The residue sweep, which already holds the user's id from
 * its Customers listing, passes it; anyone else is looked up in one read of every user, since
 * there is no server search of users.
 */
export async function removeUser(
  api: APIRequestContext,
  headers: AuthHeaders,
  created: Pick<JourneyUser, 'username' | 'email'> & { id?: string },
  log: Log,
) {
  const user = created.id === undefined ? await findUserByUsername(api, headers, created.username) : { id: created.id };
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
  if (reread.status() !== 404) throw new Error(`user ${created.username} STILL PRESENT after delete (re-read ${reread.status()})`);
  log(`user ${created.username} removed (re-read 404)`);
}

/** The user holding `username`, from the root admin's Customers list of every user. */
async function findUserByUsername(api: APIRequestContext, headers: AuthHeaders, username: string) {
  const list = await api.get('/api/v1/customers/users', { headers });
  if (!list.ok()) {
    throw new Error(`list users failed: ${list.status()}`);
  }
  const { users } = (await list.json()) as { users: { id: string; username: string }[] };
  return users.find((candidate) => candidate.username === username) ?? null;
}
