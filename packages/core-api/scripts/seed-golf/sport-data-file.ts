/**
 * A sport data file: what the "Load sport data" workflow loads into a running PoolMaster.
 *
 * The file carries its own scope in an envelope (sport, season, sport leagues, which kinds of
 * data it holds) ahead of the data. The loader checks the envelope and the data against it
 * before it reads the site, so a file whose data strays outside its scope writes nothing.
 * The filename is for people and is never parsed.
 *
 * Every sport in the registry loads a real schedule and fields in the one event shape below:
 * name, dates, venue, location and rounds, plus par for a stroke-play sport (golf) and an
 * optional start time for a sport whose cutoff is a set moment (a race's post time). A test
 * seed carries results of the kind its sport is scored by: golf's made-up stroke rounds, a
 * played bracket's match results (entered after release round by round, each play-in place
 * first taking its winner), or a race's real finishing order (entered after release).
 *
 * A sport that plays a bracket (basketball) may also carry each event's bracket: its matches,
 * where each winner moves on to, and the field places that stand for a play-in pairing. The
 * file names each side by a player key from the event's field, and the loader turns that into
 * the field row.
 *
 * A test slate is the one file any sport in the registry may have: one sport league's players
 * and no events, loaded as the field of an event already on the site that the run names
 * (isTestSlate). It is test data, for trying contests on an event before its real field is
 * announced.
 */

import { z } from 'zod';
import { BracketAdvancement, getSportDefinition, MatchEnding, MatchSide, matchPeriodsOf, RaceResultStatus, ScoringFamily, type Sport, sportPlaysMatches, SUPPORTED_SPORTS } from '@poolmaster/shared/domain';
import { findBracketProblems } from '../../src/modules/events/sport-event-bracket-service';
import { placesFormFinishingOrder } from '../../src/modules/scoring-families/finish-position/race-order';

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
  /** Each event's bracket: its matches, where each winner moves on to, and their times. */
  BRACKET: 'BRACKET',
  /** Made-up odds, tiers, prices and scores; test data only. */
  RESULTS: 'RESULTS',
} as const;
export type SportDataContent = (typeof SportDataContent)[keyof typeof SportDataContent];

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
  /**
   * The bracket seed, where it is not the entry's place in the field: 1-16 in each March
   * Madness region, 1-7 in each NFL conference. Left out, the seed is that place; null, the
   * entry is unseeded, as a tennis draw's players outside its 32 seeds are (#704).
   */
  seed: z.number().int().positive().nullable().optional(),
  /** A bracket sport's only: this place stands for a play-in pairing ("Texas / Xavier"), whose winner is named after release. */
  isPlayInPlace: z.boolean().optional(),
  // Test data only (RESULTS):
  oddsToWin: z.number().positive().optional(),
  /**
   * A play-in place's winner (the NBA play-in's 8 seed): a key from the same sport league's
   * players, not in the field. Set on the place after release, before any result.
   */
  playInWinner: z.string().min(1).optional(),
  /** Strokes per round played. A withdrawal's last entry is the partial round. */
  rounds: z.array(z.number().int().positive()).optional(),
  /** MC: missed the cut after round 2. WD: withdrew during their last round. */
  finish: z.enum(['MC', 'WD']).optional(),
  /** Holes a withdrawn golfer finished in their last round. */
  withdrawnThru: z.number().int().min(1).max(17).optional(),
  /**
   * A race's result for this runner, entered after release as the admin's official finishing
   * order: a place for a finisher (a dead heat repeats it), none for any other status.
   */
  raceResult: z.object({
    status: z.nativeEnum(RaceResultStatus),
    finishPosition: z.number().int().min(1).nullable(),
    /** Post position or grid slot. */
    startPosition: z.number().int().min(1).nullable().optional(),
    /** The jockey, for a horse. */
    riderName: z.string().min(1).nullable().optional(),
  }).strict().optional(),
}).strict();

const MatchSchema = z.object({
  /** Unique within the event: the bracket slot and the display order. */
  matchNumber: z.number().int().min(1),
  roundNumber: z.number().int().min(1),
  /** A player key from the event's field, or null where an earlier match's winner fills the side. */
  home: z.string().min(1).nullable(),
  away: z.string().min(1).nullable(),
  isNeutralSite: z.boolean(),
  /** Tip-off or kickoff, with its UTC offset, once it is announced. A time left out keeps the site's. */
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  /**
   * Where the winner moves on to; null for the final. In a league that reseeds, also null for
   * each match of a round whose winners are placed by seed (the NFL's Wild Card games).
   */
  advancesTo: z.object({ matchNumber: z.number().int().min(1), side: z.nativeEnum(MatchSide) }).strict().nullable(),
  /** The region or conference the match is played in ("AFC", "East"); left out for none. */
  regionLabel: z.string().min(1).max(40).optional(),
  /**
   * Test data only (RESULTS): the match's result, entered after release in round order. `winner`
   * is the side as the match stands when its result goes in: in a reseeded round, the side the
   * server's reseed placed the team on. `ending` says how a match that stopped early ended
   * (#704; left out is played to its end): a walkover's scores are null.
   */
  result: z.object({
    winner: z.nativeEnum(MatchSide),
    homeScore: z.number().int().min(0).nullable(),
    awayScore: z.number().int().min(0).nullable(),
    /**
     * A level knockout match's shoot-out (#791), in a sport that holds them: both sides' kicks
     * scored, apart from the score after extra time. Left out for a match settled in play.
     */
    homeShootoutScore: z.number().int().min(0).optional(),
    awayShootoutScore: z.number().int().min(0).optional(),
    ending: z.nativeEnum(MatchEnding).optional(),
  }).strict().optional(),
  /**
   * Test data only (RESULTS), for a sport with periods (#772): the score at the end of each period
   * but the last, as the scoreboard showed it, entered before the match's result. The last
   * period's score is the result's.
   */
  periodScores: z.array(z.object({
    periodNumber: z.number().int().min(1),
    homeScore: z.number().int().min(0),
    awayScore: z.number().int().min(0),
  }).strict()).optional(),
}).strict();

const EventSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  /** The event's real dates. A test seed moves them forward (shiftedEventDates). */
  startDate: IsoDaySchema,
  endDate: IsoDaySchema,
  /**
   * The exact start, with its UTC offset, when it is known: a race's post time. It is the
   * entry cutoff, so a file gives it once the track or organiser announces it. Without it the
   * event starts at noon UTC on its start date.
   */
  startsAt: z.string().datetime({ offset: true }).optional(),
  venue: z.string().min(1).nullable(),
  location: z.string().min(1).nullable(),
  /** Seven at most: a tennis Grand Slam's 128-player draw (#704). */
  rounds: z.number().int().min(1).max(7),
  /** Par per round: a stroke-play sport's only, null for every other. */
  roundsPar: z.number().int().min(60).max(80).nullable(),
  /** Test data only: whether the made-up winner is the public one. */
  winner: z.enum(['public', 'generated']).optional(),
  field: z.array(FieldEntrySchema),
  /** A bracket sport's only: the event's bracket, every match of it. */
  matches: z.array(MatchSchema).optional(),
}).strict();

const SportLeagueSchema = z.object({
  name: z.string().min(1),
  /** How its brackets fill later rounds; left out keeps the site's (FIXED for a new league). */
  bracketAdvancement: z.nativeEnum(BracketAdvancement).optional(),
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
export type SportDataMatch = z.infer<typeof MatchSchema>;
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

const TEST_ONLY_FIELD_KEYS = ['oddsToWin', 'playInWinner', 'rounds', 'finish', 'withdrawnThru', 'raceResult'] as const;
const GOLF_ONLY_FIELD_KEYS = ['rounds', 'finish', 'withdrawnThru'] as const;

const TEST_SLATE_CONTENTS: readonly SportDataContent[] = [SportDataContent.PLAYERS, SportDataContent.FIELDS];

/**
 * What every test seed holds. A golf seed's results are made-up stroke rounds; a bracket sport's
 * seed adds BRACKET, and its results are each match's; a race's results are its finishing order.
 */
export const TEST_SEED_CONTENTS: readonly SportDataContent[] = [
  SportDataContent.SCHEDULE,
  SportDataContent.PLAYERS,
  SportDataContent.FIELDS,
  SportDataContent.RESULTS,
];

/**
 * A test slate: test data that holds only PLAYERS and FIELDS. Its one sport league's players,
 * in file order, become the field of the event a run names (`--event`).
 */
export function isTestSlate(file: { testData: boolean; scope: { contents: readonly SportDataContent[] } }): boolean {
  return file.testData
    && file.scope.contents.length === TEST_SLATE_CONTENTS.length
    && TEST_SLATE_CONTENTS.every((content) => file.scope.contents.includes(content));
}

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

/**
 * The bracket's shape problems, by the same check the bracket endpoint applies, with each side
 * named by a player key; empty when the event's field is the file's to say.
 */
function bracketProblems(league: SportDataLeague, event: SportDataEvent, matches: readonly SportDataMatch[]): string[] {
  return findBracketProblems(
    matches.map((match) => ({
      matchNumber: match.matchNumber,
      roundNumber: match.roundNumber,
      homeSportEventParticipantId: match.home,
      awaySportEventParticipantId: match.away,
      isNeutralSite: match.isNeutralSite,
      scheduledDate: null,
      advancesTo: match.advancesTo,
      regionLabel: match.regionLabel ?? null,
    })),
    {
      roundNumbers: new Set(Array.from({ length: event.rounds }, (_, index) => index + 1)),
      fieldIds: new Set(event.field.map((entry) => entry.player)),
      reseeds: league.bracketAdvancement === BracketAdvancement.RESEED_BY_SEED,
    },
  );
}

/** How a test seed's results are carried, by what the sport is scored on. */
const SeedResults = {
  /** Golf: made-up strokes per round on each field entry. */
  STROKE_ROUNDS: 'STROKE_ROUNDS',
  /** A bracket: each match's result. */
  MATCH_RESULTS: 'MATCH_RESULTS',
  /** A race: each field entry's raceResult. */
  FINISHING_ORDER: 'FINISHING_ORDER',
} as const;
type SeedResults = (typeof SeedResults)[keyof typeof SeedResults];

const SEED_RESULTS: Readonly<Record<ScoringFamily, SeedResults>> = {
  [ScoringFamily.STROKE_PLAY]: SeedResults.STROKE_ROUNDS,
  [ScoringFamily.HEAD_TO_HEAD]: SeedResults.MATCH_RESULTS,
  [ScoringFamily.FINISH_POSITION]: SeedResults.FINISHING_ORDER,
};

function checkLeague(league: SportDataLeague, file: ParsedSportDataFile, hasPar: boolean, playsBracket: boolean, results: SeedResults, problems: string[]): void {
  const contents = new Set(file.scope.contents);
  for (const key of duplicates(league.players.map((player) => player.key))) {
    problems.push(`${league.name}: player key ${key} appears more than once.`);
  }
  for (const name of duplicates(league.events.map((event) => event.name.toLowerCase()))) {
    problems.push(`${league.name}: event ${name} appears more than once.`);
  }
  if (!playsBracket && league.bracketAdvancement === BracketAdvancement.RESEED_BY_SEED) {
    problems.push(`${league.name}: reseeds its brackets, which only a sport played as a bracket has.`);
  }
  const playerKeys = new Set(league.players.map((player) => player.key));
  for (const event of league.events) {
    const where = `${league.name}, ${event.name}`;
    if (Number(event.startDate.slice(0, 4)) !== file.scope.season) {
      problems.push(`${where}: starts ${event.startDate}, outside the ${file.scope.season} season.`);
    }
    if (event.endDate < event.startDate) problems.push(`${where}: ends ${event.endDate}, before it starts.`);
    if (event.startsAt !== undefined && event.startsAt.slice(0, 10) !== event.startDate) {
      problems.push(`${where}: startsAt ${event.startsAt} is not on its start date ${event.startDate}.`);
    }
    if (!hasPar && event.roundsPar !== null) problems.push(`${where}: has a par, which only a stroke-play sport has.`);
    if (event.field.length > 0 && !contents.has(SportDataContent.FIELDS)) {
      problems.push(`${where}: has a field, but the scope's contents leave out FIELDS.`);
    }
    for (const key of duplicates(event.field.map((entry) => entry.player))) {
      problems.push(`${where}: ${key} is in the field more than once.`);
    }
    const matches = event.matches ?? [];
    if (matches.length > 0) {
      if (!playsBracket) problems.push(`${where}: has a bracket, which only a sport played as a bracket has.`);
      else if (!contents.has(SportDataContent.BRACKET)) problems.push(`${where}: has a bracket, but the scope's contents leave out BRACKET.`);
      else for (const problem of bracketProblems(league, event, matches)) problems.push(`${where}: bracket: ${problem}.`);
    }
    if (!playsBracket && event.field.some((entry) => entry.isPlayInPlace !== undefined || entry.seed !== undefined)) {
      problems.push(`${where}: marks a seed or a play-in place, which only a sport played as a bracket has.`);
    }
    const fieldKeys = new Set(event.field.map((entry) => entry.player));
    for (const entry of event.field) {
      if (!playerKeys.has(entry.player)) problems.push(`${where}: ${entry.player} is not in ${league.name}'s players.`);
      if (entry.playInWinner !== undefined) {
        if (entry.isPlayInPlace !== true) problems.push(`${where}: ${entry.player} names a play-in winner, but is not a play-in place.`);
        if (!playerKeys.has(entry.playInWinner)) problems.push(`${where}: ${entry.player}'s play-in winner ${entry.playInWinner} is not in ${league.name}'s players.`);
        if (fieldKeys.has(entry.playInWinner)) problems.push(`${where}: ${entry.player}'s play-in winner ${entry.playInWinner} is already in the field.`);
      }
      if (file.testData && results === SeedResults.STROKE_ROUNDS) {
        if (entry.oddsToWin === undefined || entry.rounds === undefined) {
          problems.push(`${where}: ${entry.player} needs oddsToWin and rounds in test data.`);
        }
        if (entry.raceResult !== undefined) problems.push(`${where}: ${entry.player} carries raceResult, which only a race's test seed has.`);
      } else if (file.testData) {
        if (entry.oddsToWin === undefined) problems.push(`${where}: ${entry.player} needs oddsToWin in test data.`);
        const golfOnly = GOLF_ONLY_FIELD_KEYS.filter((key) => entry[key] !== undefined);
        if (golfOnly.length > 0) problems.push(`${where}: ${entry.player} carries ${golfOnly.join(', ')}, which only a golf test seed has.`);
        if (results === SeedResults.FINISHING_ORDER && entry.raceResult === undefined) problems.push(`${where}: ${entry.player} needs raceResult in test data.`);
        if (results === SeedResults.MATCH_RESULTS && entry.raceResult !== undefined) problems.push(`${where}: ${entry.player} carries raceResult, which only a race's test seed has.`);
        const result = entry.raceResult;
        if (result !== undefined && (result.status === RaceResultStatus.FINISHED) !== (result.finishPosition !== null)) {
          problems.push(`${where}: ${entry.player} has a finishing place only if it finished, and needs one if it did.`);
        }
      } else {
        const madeUp = TEST_ONLY_FIELD_KEYS.filter((key) => entry[key] !== undefined);
        if (madeUp.length > 0) problems.push(`${where}: ${entry.player} carries ${madeUp.join(', ')}, which only test data may.`);
      }
    }
    if (!file.testData && event.winner !== undefined) problems.push(`${where}: carries a winner, which only test data may.`);
    if (file.testData && results === SeedResults.STROKE_ROUNDS && event.roundsPar === null) problems.push(`${where}: needs roundsPar in test data, to score its rounds.`);
    if (file.testData && results === SeedResults.FINISHING_ORDER) {
      const places = event.field.flatMap((entry) => {
        const place = entry.raceResult?.finishPosition;
        return place === undefined || place === null ? [] : [place];
      });
      if (!placesFormFinishingOrder(places)) problems.push(`${where}: the finishing places do not run 1, 2, 3 ... (a dead heat repeats a place and skips the next).`);
    }
    if (!file.testData && matches.some((match) => match.result !== undefined)) problems.push(`${where}: carries match results, which only test data may.`);
    if (!file.testData && matches.some((match) => match.periodScores !== undefined)) problems.push(`${where}: carries period scores, which only test data may.`);
    for (const problem of periodScoreProblems(file.scope.sport, matches)) problems.push(`${where}: ${problem}.`);
  }
}

/** What is wrong with the matches' period scores: a sport without periods, the last period or past it, or a period twice or out of order. */
function periodScoreProblems(sport: string, matches: readonly SportDataMatch[]): string[] {
  // The sport's layout: a sport league that plays fewer periods (#786) has its own checked by the server as the scores go in.
  const periods = isSport(sport) ? matchPeriodsOf(sport, null) : undefined;
  return matches.flatMap((match) => {
    const scores = match.periodScores ?? [];
    if (scores.length === 0) return [];
    if (!periods) return [`match ${match.matchNumber} carries period scores, but its sport keeps no score by period`];
    const problems: string[] = [];
    if (match.result === undefined) problems.push(`match ${match.matchNumber} carries period scores but no result, and they are entered with its result`);
    if (scores.some((score) => score.periodNumber >= periods.count)) {
      problems.push(`match ${match.matchNumber} has a score for ${periods.label.one} ${periods.count} or later, which is the result's final score`);
    }
    if (scores.some((score, index) => index > 0 && score.periodNumber <= scores[index - 1].periodNumber)) {
      problems.push(`match ${match.matchNumber}'s period scores are not in period order, once each`);
    }
    return problems;
  });
}

/**
 * Reads a parsed JSON file as sport data, or throws SportDataFileError listing every problem:
 * an unknown schema version, a sport outside the registry, data outside
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
  const slate = isTestSlate(file);
  if (!isSport(sport)) {
    problems.push(`scope.sport ${sport} is not a sport in the sport registry.`);
  }
  const strokePlay = isSport(sport) && getSportDefinition(sport).scoringFamily === ScoringFamily.STROKE_PLAY;
  const playsBracket = isSport(sport) && sportPlaysMatches(sport);

  const contents = new Set(file.scope.contents);
  if (contents.has(SportDataContent.FIELDS) && !contents.has(SportDataContent.PLAYERS)) {
    problems.push('scope.contents has FIELDS without PLAYERS: a field names its players, so the file carries them.');
  }
  if (contents.has(SportDataContent.BRACKET) && !contents.has(SportDataContent.FIELDS)) {
    problems.push('scope.contents has BRACKET without FIELDS: a bracket names field places, so the file carries the field.');
  }
  if (isSport(sport) && contents.has(SportDataContent.BRACKET) && !playsBracket) {
    problems.push(`scope.contents has BRACKET, but a ${getSportDefinition(sport).name.toLowerCase()} event is not played as a bracket.`);
  }
  if (slate) {
    if (file.sportLeagues.length !== 1) problems.push(`A test slate holds one sport league; this one has ${file.sportLeagues.length}.`);
    for (const league of file.sportLeagues) {
      if (league.events.length > 0) problems.push(`${league.name}: a test slate has no events; the run names the event it fills.`);
      if (league.players.length === 0) problems.push(`${league.name}: a test slate needs players.`);
    }
  }
  if (file.testData) {
    const missing = TEST_SEED_CONTENTS.filter((content) => !contents.has(content));
    if (!slate && missing.length > 0) {
      problems.push(`testData needs ${TEST_SEED_CONTENTS.join(', ')} (a test seed), or just PLAYERS and FIELDS (a test slate); missing ${missing.join(', ')}.`);
    }
    if (!slate && playsBracket && !contents.has(SportDataContent.BRACKET)) {
      problems.push('A bracket sport\'s test seed needs BRACKET: its results are the bracket\'s match results.');
    }
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
  // An unknown sport is already refused; its par is not worth a second problem.
  // An unknown sport's entries are read as a bracket's, which asks least of them.
  const results = isSport(sport) ? SEED_RESULTS[getSportDefinition(sport).scoringFamily] : SeedResults.MATCH_RESULTS;
  for (const league of file.sportLeagues) checkLeague(league, file, strokePlay || !isSport(sport), playsBracket || !isSport(sport), results, problems);

  if (problems.length > 0 || !isSport(sport)) throw new SportDataFileError(problems);
  return { ...file, scope: { ...file.scope, sport } };
}
