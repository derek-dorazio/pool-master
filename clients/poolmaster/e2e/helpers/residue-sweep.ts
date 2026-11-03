import type { APIRequestContext } from '@playwright/test';
import { expectOk, type AuthHeaders, type Log } from './admin-api';
import { removeLeague, removeTour, removeUser } from './journey-teardown';
import {
  E2E_EMAIL_DOMAIN,
  E2E_NAME_PREFIX,
  isRunOlderThan,
  runIdOfLeagueCode,
  runIdOfName,
  runIdOfUser,
} from './test-marker';

/**
 * #1401 — the QA residue sweep. Every spec removes what it made in its own teardown, but a run
 * that is cancelled or times out never reaches it, and leaves its whole set behind. The sweep finds
 * those leftovers by the one test-name marker (`test-marker.ts`) and removes them through the
 * admin API, with the same helpers the teardowns use: leagues (their contests, entries, squads and
 * cups go with them) → events → tours → players → users. Each league is deleted on its own, as
 * the API deletes one tenant at a time; nothing here touches the database.
 *
 * Only runs older than `minAgeMs` are removed, so a live run is never raced. A failed removal is
 * logged and reported, and the rest still run: one stuck row never keeps the others.
 */

export interface SweepOptions {
  /** Leave alone any run younger than this. */
  minAgeMs: number;
  /** Only this run's residue; every e2e run's when unset. */
  onlyRunId?: string;
  now?: Date;
  log: Log;
}

/** What the sweep removed, by kind, named as the API names each one, and what it could not. */
export interface SweepReport {
  leagues: string[];
  events: string[];
  tours: string[];
  players: string[];
  users: string[];
  /** Runs that matched the marker but were too young to touch. */
  skippedRunIds: string[];
  /** Each removal or listing that failed, with why. */
  failures: string[];
}

/** QA is the only deployed environment the sweep may touch; a local stack serves for its own check. */
const SWEEPABLE_HOSTS = new Set(['qa.ultimateofficepoolmanager.com', 'localhost', '127.0.0.1']);

/** Throws unless `baseUrl` is QA or a local stack: never stage, never prod. */
export function assertSweepableBaseUrl(baseUrl: string): void {
  const { hostname } = new URL(baseUrl);
  if (!SWEEPABLE_HOSTS.has(hostname)) {
    throw new Error(`The e2e residue sweep runs only against QA or a local stack, not ${hostname}.`);
  }
}

export async function sweepE2eResidue(api: APIRequestContext, headers: AuthHeaders, options: SweepOptions): Promise<SweepReport> {
  const { log } = options;
  const now = options.now ?? new Date();
  const report: SweepReport = { leagues: [], events: [], tours: [], players: [], users: [], skippedRunIds: [], failures: [] };
  /** Runs one removal or listing; success lands `name` in `removed`, a failure in the report. */
  const remove = async (what: string, run: () => Promise<void>, removed?: string[], name?: string) => {
    try {
      await run();
      if (removed && name !== undefined) removed.push(name);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      report.failures.push(`${what}: ${why}`);
      log(`could not remove ${what}; it remains: ${why}`);
    }
  };
  const skipped = new Set<string>();
  /** Whether residue of this run id should go now; a young run is noted as skipped. */
  const due = (runId: string | null): runId is string => {
    if (runId === null) return false;
    if (options.onlyRunId !== undefined && runId !== options.onlyRunId) return false;
    if (!isRunOlderThan(runId, options.minAgeMs, now)) {
      skipped.add(runId);
      return false;
    }
    return true;
  };

  await remove('leagues (listing)', async () => {
    const list = await expectOk(
      api.get('/api/v1/leagues', { headers, params: { scope: 'all', search: E2E_NAME_PREFIX } }),
      'list leagues',
    );
    const { leagues } = (await list.json()) as { leagues: { name: string; leagueCode: string }[] };
    for (const league of leagues.filter((candidate) => due(runIdOfLeagueCode(candidate.leagueCode)) && runIdOfName(candidate.name) !== null)) {
      await remove(`league ${league.leagueCode}`, () => removeLeague(api, headers, league.leagueCode, log), report.leagues, league.leagueCode);
    }
  });

  await remove('tours (listing)', async () => {
    const list = await expectOk(api.get('/api/v1/sport-leagues', { headers }), 'list tours');
    const { sportLeagues } = (await list.json()) as { sportLeagues: { id: string; name: string }[] };
    for (const tour of sportLeagues.filter((candidate) => due(runIdOfName(candidate.name)))) {
      // A tour is refused while it has an event, so its events go first.
      await remove(`events of tour "${tour.name}" (listing)`, async () => {
        const events = await expectOk(
          api.get('/api/v1/events', { headers, params: { sportLeagueId: tour.id } }),
          `list events of ${tour.name}`,
        );
        const { events: rows } = (await events.json()) as { events: { id: string; name: string }[] };
        for (const event of rows.filter((candidate) => runIdOfName(candidate.name) !== null)) {
          await remove(`event "${event.name}"`, async () => {
            await expectOk(api.delete(`/api/v1/events/${event.id}`, { headers }), `delete event ${event.name}`);
            log(`event "${event.name}" removed`);
          }, report.events, event.name);
        }
      });
      await remove(`tour "${tour.name}"`, () => removeTour(api, headers, tour.id, tour.name, log), report.tours, tour.name);
    }
  });

  await remove('players (listing)', async () => {
    const list = await expectOk(api.get('/api/v1/participants', { headers, params: { q: E2E_NAME_PREFIX } }), 'search players');
    const { participants } = (await list.json()) as { participants: { id: string; name: string }[] };
    // A player is refused while an event field holds them, which is why the events went first.
    for (const player of participants.filter((candidate) => due(runIdOfName(candidate.name)))) {
      await remove(`player "${player.name}"`, async () => {
        await expectOk(api.delete(`/api/v1/participants/${player.id}`, { headers }), `delete player ${player.name}`);
        log(`player "${player.name}" removed`);
      }, report.players, player.name);
    }
  });

  await remove('users (listing)', async () => {
    const list = await expectOk(api.get('/api/v1/users/', { headers, params: { search: E2E_EMAIL_DOMAIN } }), 'search users');
    const { users } = (await list.json()) as { users: { username: string; email: string; isRootAdmin: boolean }[] };
    // A root admin is never a run's: the suite's own admin has an e2e address too.
    for (const user of users.filter((candidate) => !candidate.isRootAdmin && due(runIdOfUser(candidate)))) {
      await remove(`user ${user.username}`, () => removeUser(api, headers, user, log), report.users, user.username);
    }
  });

  report.skippedRunIds = [...skipped].sort();
  return report;
}

/** The report as Markdown, for the workflow's step summary. */
export function describeSweepReport(report: SweepReport, baseUrl: string): string {
  const section = (title: string, items: readonly string[]) => (
    items.length === 0 ? [`- ${title}: none`] : [`- ${title} (${items.length}):`, ...items.map((item) => `  - \`${item}\``)]
  );
  return [
    `## E2E residue removed from ${new URL(baseUrl).hostname}`,
    '',
    ...section('Leagues', report.leagues),
    ...section('Events', report.events),
    ...section('Tours', report.tours),
    ...section('Players', report.players),
    ...section('Users', report.users),
    ...section('Runs too recent to touch', report.skippedRunIds),
    ...section('Could not remove', report.failures),
    '',
  ].join('\n');
}
