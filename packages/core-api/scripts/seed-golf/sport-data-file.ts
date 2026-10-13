/**
 * A sport data file: what the "Load sport data" workflow loads into a running PoolMaster.
 *
 * The file carries its own scope in an envelope (sport, season, sport leagues, which kinds of
 * data it holds) ahead of the data. The loader checks the envelope and the data against it
 * before it reads the site, so a file whose data strays outside its scope writes nothing.
 * The filename is for people and is never parsed.
 *
 * Only golf loads so far, so the data shape below is golf's: rounds and par on each event,
 * stroke rounds on each field entry of a test seed. Another sport adds its own shape here,
 * chosen by `scope.sport`.
 */

import { z } from 'zod';
import { Sport, SUPPORTED_SPORTS } from '@poolmaster/shared/domain';

/** The one envelope version this loader reads; any other is refused rather than misread. */
export const SPORT_DATA_SCHEMA_VERSION = 1;

/** What kinds of data a file holds, and so what a run of it may change. */
export const SportDataContent = {
  /** Events: name, dates, venue, location, rounds, par. */
  SCHEDULE: 'SCHEDULE',
  /** Players and their sport league affiliation and ranking. */
  PLAYERS: 'PLAYERS',
  /** Each event's field: who plays, their ranking and seed. */
  FIELDS: 'FIELDS',
  /** Made-up odds, tiers, prices and scores; test data only. */
  RESULTS: 'RESULTS',
} as const;
export type SportDataContent = (typeof SportDataContent)[keyof typeof SportDataContent];

/** The sports this loader has a data shape for. */
const LOADABLE_SPORTS: readonly Sport[] = [Sport.GOLF];

const IsoDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date');

const PlayerSchema = z.object({
  /** Stored as the participant's externalId; how a later run finds the player again. */
  key: z.string().min(1),
  name: z.string().min(1),
  countryCode: z.string().length(2),
  /** The player's ranking on the sport league, set when they join it. */
  ranking: z.number().int().positive(),
}).strict();

const FieldEntrySchema = z.object({
  /** A `key` from the same sport league's players. The field's order is its seed order. */
  player: z.string().min(1),
  ranking: z.number().int().positive().optional(),
  // Test data only (RESULTS):
  oddsToWin: z.number().positive().optional(),
  /** Strokes per round played. A withdrawal's last entry is the partial round. */
  rounds: z.array(z.number().int().positive()).optional(),
  /** MC: missed the cut after round 2. WD: withdrew during their last round. */
  finish: z.enum(['MC', 'WD']).optional(),
  /** Holes a withdrawn golfer finished in their last round. */
  withdrawnThru: z.number().int().min(1).max(17).optional(),
}).strict();

const EventSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  /** The event's real dates. A test seed moves them forward (shiftedEventDates). */
  startDate: IsoDaySchema,
  endDate: IsoDaySchema,
  venue: z.string().min(1).nullable(),
  location: z.string().min(1).nullable(),
  rounds: z.number().int().min(1).max(6),
  roundsPar: z.number().int().min(60).max(80).nullable(),
  /** Test data only: whether the made-up winner is the public one. */
  winner: z.enum(['public', 'generated']).optional(),
  field: z.array(FieldEntrySchema),
}).strict();

const SportLeagueSchema = z.object({
  name: z.string().min(1),
  players: z.array(PlayerSchema),
  events: z.array(EventSchema),
}).strict();

const SportDataFileSchema = z.object({
  schemaVersion: z.number().int(),
  scope: z.object({
    sport: z.string(),
    season: z.number().int().min(2000).max(2100),
    sportLeagues: z.array(z.string().min(1)).min(1),
    contents: z.array(z.nativeEnum(SportDataContent)).min(1),
  }).strict(),
  /** Turns on the made-up parts of a test seed. Refused outside local and QA. */
  testData: z.boolean(),
  provenance: z.object({
    gatheredAt: IsoDaySchema,
    gatheredBy: z.string().min(1),
    sources: z.array(z.object({ name: z.string().min(1), url: z.string().min(1) }).strict()).min(1),
  }).strict(),
  sportLeagues: z.array(SportLeagueSchema).min(1),
}).strict();

type ParsedSportDataFile = z.infer<typeof SportDataFileSchema>;

export type SportDataPlayer = z.infer<typeof PlayerSchema>;
export type SportDataFieldEntry = z.infer<typeof FieldEntrySchema>;
export type SportDataEvent = z.infer<typeof EventSchema>;
export type SportDataLeague = z.infer<typeof SportLeagueSchema>;
export type SportDataFile = Omit<ParsedSportDataFile, 'scope'> & {
  scope: Omit<ParsedSportDataFile['scope'], 'sport'> & { sport: Sport };
};

/** A file that cannot be loaded, with every reason found, so one fix round covers them all. */
export class SportDataFileError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The sport data file cannot be loaded:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'SportDataFileError';
  }
}

export interface ParseSportDataFileOptions {
  /** Whether this target may take made-up data; only local and QA may. */
  allowTestData: boolean;
}

const TEST_ONLY_FIELD_KEYS = ['oddsToWin', 'rounds', 'finish', 'withdrawnThru'] as const;

function isSport(value: string): value is Sport {
  return (SUPPORTED_SPORTS as readonly string[]).includes(value);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function checkLeague(league: SportDataLeague, file: ParsedSportDataFile, problems: string[]): void {
  const contents = new Set(file.scope.contents);
  for (const key of duplicates(league.players.map((player) => player.key))) {
    problems.push(`${league.name}: player key ${key} appears more than once.`);
  }
  for (const name of duplicates(league.events.map((event) => event.name.toLowerCase()))) {
    problems.push(`${league.name}: event ${name} appears more than once.`);
  }
  const playerKeys = new Set(league.players.map((player) => player.key));
  for (const event of league.events) {
    const where = `${league.name}, ${event.name}`;
    if (Number(event.startDate.slice(0, 4)) !== file.scope.season) {
      problems.push(`${where}: starts ${event.startDate}, outside the ${file.scope.season} season.`);
    }
    if (event.endDate < event.startDate) problems.push(`${where}: ends ${event.endDate}, before it starts.`);
    if (event.field.length > 0 && !contents.has(SportDataContent.FIELDS)) {
      problems.push(`${where}: has a field, but the scope's contents leave out FIELDS.`);
    }
    for (const key of duplicates(event.field.map((entry) => entry.player))) {
      problems.push(`${where}: ${key} is in the field more than once.`);
    }
    for (const entry of event.field) {
      if (!playerKeys.has(entry.player)) problems.push(`${where}: ${entry.player} is not in ${league.name}'s players.`);
      if (file.testData) {
        if (entry.oddsToWin === undefined || entry.rounds === undefined) {
          problems.push(`${where}: ${entry.player} needs oddsToWin and rounds in test data.`);
        }
      } else {
        const madeUp = TEST_ONLY_FIELD_KEYS.filter((key) => entry[key] !== undefined);
        if (madeUp.length > 0) problems.push(`${where}: ${entry.player} carries ${madeUp.join(', ')}, which only test data may.`);
      }
    }
    if (!file.testData && event.winner !== undefined) problems.push(`${where}: carries a winner, which only test data may.`);
    if (file.testData && event.roundsPar === null) problems.push(`${where}: needs roundsPar in test data, to score its rounds.`);
  }
}

/**
 * Reads a parsed JSON file as sport data, or throws SportDataFileError listing every problem:
 * an unknown schema version, a sport outside the registry or not loadable yet, data outside
 * the envelope's scope, made-up data in a real file, or test data where it is not allowed.
 */
export function parseSportDataFile(json: unknown, options: ParseSportDataFileOptions): SportDataFile {
  const version = (json as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== SPORT_DATA_SCHEMA_VERSION) {
    throw new SportDataFileError([`schemaVersion is ${JSON.stringify(version)}; this loader reads version ${SPORT_DATA_SCHEMA_VERSION}.`]);
  }
  const parsed = SportDataFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new SportDataFileError(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(file)'}: ${issue.message}`));
  }
  const file = parsed.data;
  const problems: string[] = [];
  const { sport } = file.scope;
  if (!isSport(sport)) {
    problems.push(`scope.sport ${sport} is not a sport in the sport registry.`);
  } else if (!LOADABLE_SPORTS.includes(sport)) {
    problems.push(`scope.sport ${sport} has no data shape in this loader yet; it loads ${LOADABLE_SPORTS.join(', ')}.`);
  }

  const contents = new Set(file.scope.contents);
  if (contents.has(SportDataContent.FIELDS) && !contents.has(SportDataContent.PLAYERS)) {
    problems.push('scope.contents has FIELDS without PLAYERS: a field names its players, so the file carries them.');
  }
  if (file.testData) {
    const missing = Object.values(SportDataContent).filter((content) => !contents.has(content));
    if (missing.length > 0) problems.push(`testData needs every kind of contents; missing ${missing.join(', ')}.`);
    if (!options.allowTestData) problems.push('testData is true, and this target does not take test data.');
  } else if (contents.has(SportDataContent.RESULTS)) {
    problems.push('scope.contents has RESULTS, which only test data may.');
  }

  const scopeLeagues = new Set(file.scope.sportLeagues);
  const fileLeagues = new Set(file.sportLeagues.map((league) => league.name));
  for (const name of fileLeagues) {
    if (!scopeLeagues.has(name)) problems.push(`Sport league ${name} is not named in scope.sportLeagues.`);
  }
  for (const name of scopeLeagues) {
    if (!fileLeagues.has(name)) problems.push(`scope.sportLeagues names ${name}, which the file has no data for.`);
  }
  for (const name of duplicates(file.sportLeagues.map((league) => league.name))) {
    problems.push(`Sport league ${name} appears more than once.`);
  }
  for (const league of file.sportLeagues) checkLeague(league, file, problems);

  if (problems.length > 0 || !isSport(sport)) throw new SportDataFileError(problems);
  return { ...file, scope: { ...file.scope, sport } };
}
