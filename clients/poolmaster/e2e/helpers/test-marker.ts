import { randomBytes } from 'node:crypto';

/**
 * #1401 — the one marker every e2e spec names what it creates with, and the one matcher the QA
 * residue sweep finds it by, so the two cannot drift apart.
 *
 * Every spec starts with a run id: the time in base 36 then four hex characters. Each name it
 * creates carries that id:
 *
 * - leagues, tours, events, players, contests, squads: `E2E <label> <runId>`, a player with its
 *   number after the id (`E2E Golfer <runId> 3`);
 * - users: username `e2e-<role>-<runId>`, email `e2e-<role>-<runId>@e2e.invalid`;
 * - league codes: `E2E<letter?><RUNID>`.
 *
 * The run id holds the moment the run started, so the sweep can leave alone anything a run still
 * in progress may be using, without reading a creation time the API does not return.
 */

/** Every user a spec registers gets an address here, which no real person can hold (RFC 2606). */
export const E2E_EMAIL_DOMAIN = 'e2e.invalid';

/** What every e2e name starts with, and what the sweep searches the catalog lists for. */
export const E2E_NAME_PREFIX = 'E2E';

/**
 * Base 36 milliseconds (8 characters from 1973 until 2059), then 4 hex characters. A fixed length
 * keeps a league code's optional letter apart from the id that follows it.
 */
const RUN_ID = '[0-9a-z]{8}[0-9a-f]{4}';
const RUN_ID_LENGTH_HEX = 4;

const NAME_PATTERN = new RegExp(`^${E2E_NAME_PREFIX} (?:.+ )?(${RUN_ID})(?: .+)?$`);
const USERNAME_PATTERN = new RegExp(`^e2e-[a-z]+-(${RUN_ID})$`);
const EMAIL_PATTERN = new RegExp(`^e2e-[a-z]+-(${RUN_ID})@e2e\\.invalid$`);
const LEAGUE_CODE_PATTERN = new RegExp(`^${E2E_NAME_PREFIX}[A-Z]?(${RUN_ID.toUpperCase()})$`);

/** A fresh run id: now, then four random hex characters, so two runs in one millisecond differ. */
export function newRunId(now: Date = new Date()): string {
  return `${now.getTime().toString(36)}${randomBytes(RUN_ID_LENGTH_HEX / 2).toString('hex')}`;
}

/** `E2E <label> <runId>`: a league, tour, event, contest, squad or player prefix. */
export function e2eName(label: string, runId: string): string {
  return `${E2E_NAME_PREFIX} ${label} ${runId}`;
}

/** `e2e-<role>-<runId>`, a lower-case role such as `c` for a commissioner. */
export function e2eUsername(role: string, runId: string): string {
  return `e2e-${role}-${runId}`;
}

/** `e2e-<role>-<runId>@e2e.invalid`. */
export function e2eEmail(role: string, runId: string): string {
  return `${e2eUsername(role, runId)}@${E2E_EMAIL_DOMAIN}`;
}

/** `E2E<letter><RUNID>`: a league code, upper case as league codes are. */
export function e2eLeagueCode(letter: string, runId: string): string {
  return `${E2E_NAME_PREFIX}${letter}${runId.toUpperCase()}`;
}

/** The run id an e2e name carries, or null for a name no spec made. */
export function runIdOfName(name: string): string | null {
  return NAME_PATTERN.exec(name)?.[1] ?? null;
}

/** The run id an e2e user carries, from username and email both, or null unless both are a spec's. */
export function runIdOfUser(user: { username: string; email: string }): string | null {
  const fromUsername = USERNAME_PATTERN.exec(user.username)?.[1];
  const fromEmail = EMAIL_PATTERN.exec(user.email.toLowerCase())?.[1];
  return fromUsername && fromUsername === fromEmail ? fromUsername : null;
}

/** The run id an e2e league code carries, lower case, or null. */
export function runIdOfLeagueCode(leagueCode: string): string | null {
  return LEAGUE_CODE_PATTERN.exec(leagueCode)?.[1]?.toLowerCase() ?? null;
}

/** When the run started, read from its id. */
export function runStartedAt(runId: string): Date {
  return new Date(Number.parseInt(runId.slice(0, -RUN_ID_LENGTH_HEX), 36));
}

/** Whether a run started at least `minAgeMs` before `now`: old enough that no live run still uses it. */
export function isRunOlderThan(runId: string, minAgeMs: number, now: Date = new Date()): boolean {
  return now.getTime() - runStartedAt(runId).getTime() >= minAgeMs;
}
