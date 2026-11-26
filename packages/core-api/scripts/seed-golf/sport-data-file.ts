/**
 * A test data file: what the "Load test data" workflow loads into a running PoolMaster (#1850).
 * Every file is test data: real events and fields reach the site through the provider sync
 * (docs/LIVE-SPORTS-DATA-SYNC.md), never through a file.
 *
 * The file carries its own scope in an envelope (sport, season, sport leagues, who competes in
 * them and how they are scored, which kinds of data it holds) ahead of the data. The participant
 * type and scoring family are the sport leagues' own (#2001): the loader checks them against
 * each league on the site, and makes a league it does not find with them. The loader checks the envelope and the data against it
 * before it reads the site, so a file whose data strays outside its scope writes nothing.
 * The filename is for people and is never parsed.
 *
 * Every sport in the registry loads a schedule and fields in the one event shape below: name,
 * dates, venue, location and rounds, plus par for a stroke-play sport (golf) and an optional
 * start time for a sport whose cutoff is a set moment (a race's post time). A test seed carries
 * results of the kind its sport is scored by: golf's made-up stroke rounds, a
 * played bracket's match results (entered after release round by round), or a race's real
 * finishing order (entered after release).
 *
 * A sport that plays a bracket (basketball) may also carry each event's bracket: its matches on
 * their two sides, and where each winner moves on to, as the next match and its side (#2184).
 * The file names each side by a player key from the event's field, and the loader turns that
 * into the field row. A play-in winner sits straight in the place it won.
 *
 * A test slate is the one file any sport in the registry may have: one sport league's players
 * and no events, loaded as the field of an event already on the site that the run names
 * (isTestSlate), for trying contests on an event before its real field is announced.
 *
 * A player may carry the provider's feed id for it (`feedIds`): the loader binds it to the
 * player's participant, so the provider sync and the test data share one participant row and
 * never make a duplicate. A test event never carries one (#1850): it is a date-shifted copy of
 * last season, and a real event or game id would let the live-score poll write real results
 * onto it.
 */

import { z } from 'zod';
import { describeMatchPlace, getSportDefinition, LEAGUE_PLAY_BY_SCORING_FAMILY, MatchFormat, ProviderCode, HomeAway, MatchEnding, ParticipantType, RaceResultStatus, ScoringFamily, type Sport, SUPPORTED_SPORTS, URL_SEGMENT_PATTERN } from '@poolmaster/shared/domain';
import { findBracketProblems, formsNoBracket } from '../../src/modules/events/sport-event-bracket-service';
import { placesFormFinishingOrder } from '../../src/modules/scoring-families/finish-position/race-order';

/** The one envelope version this loader reads; any other is refused rather than misread. */
export const SPORT_DATA_SCHEMA_VERSION = 1;

/** What kinds of data a file holds, and so what a run of it may change. */
export const SportDataContent = {
  /** Events: name, dates, venue, location, rounds, par. */
  SCHEDULE: 'SCHEDULE',
  /** The sport league's players and their ranking in it. */
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
  /** The player's key within the file: how its field entries name it. */
  key: z.string().min(1),
  /**
   * The player's feed id at each provider, keyed by Provider code (`BALLDONTLIE`), as the
   * provider's own raw id (`17`, never `nfl-team-17`, #2040). The loader finds the participant by
   * it, or binds it to the one it finds or creates, so the sync fields that same participant
   * (#1850). Left out where no provider serves the league yet.
   */
  feedIds: z.partialRecord(z.enum(ProviderCode), z.string().min(1)).optional(),
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
  // Test data only (RESULTS):
  oddsToWin: z.number().positive().optional(),
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
    status: z.enum(RaceResultStatus),
    finishPosition: z.number().int().min(1).nullable(),
    /** Post position or grid slot. */
    startPosition: z.number().int().min(1).nullable().optional(),
    /** The jockey, for a horse. */
    riderName: z.string().min(1).nullable().optional(),
  }).strict().optional(),
}).strict();

/** Both sides of a match, once each: checked here rather than as a fixed-length array, so clients read a plain list. */
const bothSides = <T extends z.ZodType<{ sideNumber: number }>>(side: T) => z.array(side)
  .refine((sides) => sides.length === 2 && new Set(sides.map((each) => each.sideNumber)).size === 2, { message: 'name side 1 and side 2 once each' });
const SideNumberSchema = z.number().int().min(1).max(2);

const MatchSchema = z.object({
  /** Unique within its round (#2161): the match's place in the round and its display order. */
  matchNumber: z.number().int().min(1),
  roundNumber: z.number().int().min(1),
  /**
   * Side 1 and side 2 (#2184): each a player key from the event's field, or null where an earlier
   * match's winner fills the side, and where the side plays game 1 (NONE for both at a neutral
   * site). A synced game has its away team on side 1 and its home team on side 2.
   */
  sides: bothSides(z.object({
    sideNumber: SideNumberSchema,
    player: z.string().min(1).nullable(),
    homeAway: z.enum(HomeAway),
  }).strict()),
  isNeutralSite: z.boolean(),
  /** Tip-off or kickoff, with its UTC offset, once it is announced. A time left out keeps the site's. */
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  /**
   * Where the winner moves on to, as the next match and its side; null for the final. In a
   * reseeded slot, also null for each match of a round whose winners are placed by seed (the
   * NFL's Wild Card games).
   */
  advancesTo: z.object({ roundNumber: z.number().int().min(1), matchNumber: z.number().int().min(1), sideNumber: SideNumberSchema }).strict().nullable(),
  /** The region or conference the match is played in ("AFC", "East"); left out for none. */
  regionLabel: z.string().min(1).max(40).optional(),
  /**
   * Test data only (RESULTS): the match's result, entered after release in round order.
   * `winnerSideNumber` is the side as the match stands when its result goes in: in a reseeded
   * round, the side the server's reseed placed the team on, or null for a game of a week left
   * level (#787), which a week allows and a bracket match never does. Each side's `shootoutScore`
   * is a level knockout match's shoot-out (#791), in a sport that holds them, apart from the
   * score after extra time; left out for a match settled in play. `ending` says how a match that
   * stopped early ended (#704; left out is played to its end): a walkover's scores are null.
   */
  result: z.object({
    winnerSideNumber: SideNumberSchema.nullable(),
    sides: bothSides(z.object({
      sideNumber: SideNumberSchema,
      score: z.number().int().min(0).nullable(),
      shootoutScore: z.number().int().min(0).optional(),
    }).strict()),
    ending: z.enum(MatchEnding).optional(),
  }).strict().optional(),
  /**
   * Test data only (RESULTS), for a sport with periods (#772): each side's score at the end of
   * each period but the last, as the scoreboard showed it, entered before the match's result.
   * The last period's score is the result's.
   */
  periodScores: z.array(z.object({
    periodNumber: z.number().int().min(1),
    sides: bothSides(z.object({ sideNumber: SideNumberSchema, score: z.number().int().min(0) }).strict()),
  }).strict()).optional(),
  /**
   * Test data only (RESULTS): the game was postponed out of its week (a Premier League match moved
   * for a cup tie), so it is cancelled after release, as an admin cancels it, and carries no
   * result. It stays in the file because the week's field still holds both its teams, and the
   * release refuses a field member in no game. Only a week's game can be: a bracket cannot lose one.
   */
  cancelled: z.literal(true).optional(),
}).strict();

const EventSchema = z.object({
  /** Unique in the file; a test event's test slot is labelled with it, so 64 characters at most. */
  key: z.string().min(1).max(64),
  /**
   * The key of the league's slot definition the event plays (#2004): the loader makes a test
   * event on a test slot of it. An event the league has no definition for is not loaded.
   */
  slotKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  /**
   * A bracket's slot definition keys, one per round, first to final (#2006): the loader makes the
   * event on a test slot of each, and plays its round n in the nth. In place of `slotKey`, and as
   * many as the event has rounds.
   */
  roundSlotKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).min(2).optional(),
  name: z.string().min(1),
  /** The event's real dates. A test seed moves them forward (shiftedEventDates). */
  startDate: IsoDaySchema,
  endDate: IsoDaySchema,
  /**
   * The exact start, with its UTC offset, when it is known: a race's post time. It is the
   * entry cutoff, so a file gives it once the track or organiser announces it. Without it the
   * event starts at noon UTC on its start date.
   */
  startsAt: z.iso.datetime({ offset: true }).optional(),
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
  /**
   * The league's stored URL segment (#2042): the loader finds the league by it when given, and a
   * league not on the site yet is created with it, so a file that adds a league must name one.
   */
  urlSegment: z.string().regex(URL_SEGMENT_PATTERN).optional(),
  players: z.array(PlayerSchema),
  events: z.array(EventSchema),
}).strict();

const SportDataFileSchema = z.object({
  schemaVersion: z.number().int(),
  scope: z.object({
    sport: z.string(),
    season: z.number().int().min(2000).max(2100),
    sportLeagues: z.array(z.string().min(1)).min(1),
    participantType: z.enum(ParticipantType),
    scoringFamily: z.enum(ScoringFamily),
    contents: z.array(z.enum(SportDataContent)).min(1),
  }).strict(),
  /** Every file is test data (#1850): its made-up parts load only into a local or QA site. */
  testData: z.literal(true),
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
 * What every event a test seed creates is named with: "Test- Super Bowl LX". Test events then
 * stand apart from the real ones the provider sync creates on a site holding both, and the
 * loader never matches one with the other (#1524).
 */
export const TEST_EVENT_NAME_PREFIX = 'Test- ';

/** Whether a stored or file event's name marks it as a test seed's. */
export function isTestEventName(name: string): boolean {
  return name.startsWith(TEST_EVENT_NAME_PREFIX);
}

/**
 * A test slate: test data that holds only PLAYERS and FIELDS. Its one sport league's players,
 * in file order, become the field of the event a run names (`--event`).
 */
export function isTestSlate(file: { scope: { contents: readonly SportDataContent[] } }): boolean {
  return file.scope.contents.length === TEST_SLATE_CONTENTS.length
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
function bracketProblems(event: SportDataEvent, matches: readonly SportDataMatch[]): string[] {
  return findBracketProblems(
    matches.map((match) => ({
      matchNumber: match.matchNumber,
      roundNumber: match.roundNumber,
      sides: match.sides.map(({ sideNumber, player, homeAway }) => ({ sideNumber, sportEventParticipantId: player, homeAway })),
      isNeutralSite: match.isNeutralSite,
      scheduledDate: null,
      advancesTo: match.advancesTo,
      regionLabel: match.regionLabel ?? null,
    })),
    {
      roundNumbers: new Set(Array.from({ length: event.rounds }, (_, index) => index + 1)),
      fieldIds: new Set(event.field.map((entry) => entry.player)),
      // The final and a reseed are the event's slots' (#2006), which the file does not carry: the
      // bracket load checks them.
      finalRoundNumbers: null,
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
  // One feed id is one participant to the sync: two players carrying it would be merged into one.
  for (const id of duplicates(league.players.flatMap((player) => Object.entries(player.feedIds ?? {}).map(([provider, externalId]) => `${provider} ${externalId}`)))) {
    problems.push(`${league.name}: feed id ${id} is on more than one player.`);
  }
  for (const name of duplicates(league.events.map((event) => event.name.toLowerCase()))) {
    problems.push(`${league.name}: event ${name} appears more than once.`);
  }
  const playerKeys = new Set(league.players.map((player) => player.key));
  for (const event of league.events) {
    const where = `${league.name}, ${event.name}`;
    if (event.roundSlotKeys !== undefined && event.slotKey !== undefined) {
      problems.push(`${where}: names both a slotKey and roundSlotKeys; a bracket over several slots names only its rounds' keys.`);
    }
    if (event.roundSlotKeys !== undefined && event.roundSlotKeys.length !== event.rounds) {
      problems.push(`${where}: names ${event.roundSlotKeys.length} round slot keys for ${event.rounds} rounds.`);
    }
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
      else for (const problem of bracketProblems(event, matches)) problems.push(`${where}: bracket: ${problem}.`);
    }
    if (!playsBracket && event.field.some((entry) => entry.seed !== undefined)) {
      problems.push(`${where}: marks a seed, which only a sport played as a bracket has.`);
    }
    for (const entry of event.field) {
      if (!playerKeys.has(entry.player)) problems.push(`${where}: ${entry.player} is not in ${league.name}'s players.`);
      if (results === SeedResults.STROKE_ROUNDS) {
        if (entry.oddsToWin === undefined || entry.rounds === undefined) {
          problems.push(`${where}: ${entry.player} needs oddsToWin and rounds in test data.`);
        }
        if (entry.raceResult !== undefined) problems.push(`${where}: ${entry.player} carries raceResult, which only a race's test seed has.`);
      } else {
        if (entry.oddsToWin === undefined) problems.push(`${where}: ${entry.player} needs oddsToWin in test data.`);
        const golfOnly = GOLF_ONLY_FIELD_KEYS.filter((key) => entry[key] !== undefined);
        if (golfOnly.length > 0) problems.push(`${where}: ${entry.player} carries ${golfOnly.join(', ')}, which only a golf test seed has.`);
        if (results === SeedResults.FINISHING_ORDER && entry.raceResult === undefined) problems.push(`${where}: ${entry.player} needs raceResult in test data.`);
        if (results !== SeedResults.FINISHING_ORDER && entry.raceResult !== undefined) problems.push(`${where}: ${entry.player} carries raceResult, which only a race's test seed has.`);
        const result = entry.raceResult;
        if (result !== undefined && (result.status === RaceResultStatus.FINISHED) !== (result.finishPosition !== null)) {
          problems.push(`${where}: ${entry.player} has a finishing place only if it finished, and needs one if it did.`);
        }
      }
    }
    if (results === SeedResults.STROKE_ROUNDS && event.roundsPar === null) problems.push(`${where}: needs roundsPar in test data, to score its rounds.`);
    if (results === SeedResults.FINISHING_ORDER) {
      const places = event.field.flatMap((entry) => {
        const place = entry.raceResult?.finishPosition;
        return place === undefined || place === null ? [] : [place];
      });
      if (!placesFormFinishingOrder(places)) problems.push(`${where}: the finishing places do not run 1, 2, 3 ... (a dead heat repeats a place and skips the next).`);
    }
    for (const problem of cancelledGameProblems(matches)) problems.push(`${where}: ${problem}.`);
    for (const key of unplacedFieldMembers(event, matches)) {
      problems.push(`${where}: ${key} is in the field but in no match, and the release refuses a field member left out of the games.`);
    }
    for (const problem of periodScoreProblems(matches)) problems.push(`${where}: ${problem}.`);
    for (const problem of tieProblems(event, matches)) problems.push(`${where}: ${problem}.`);
  }
}

/**
 * What is wrong with the cancelled games: one with a result or period scores, or one in a
 * bracket, which the server refuses to cancel (`cancelMatch`).
 */
function cancelledGameProblems(matches: readonly SportDataMatch[]): string[] {
  const cancelled = matches.filter((match) => match.cancelled === true);
  if (cancelled.length === 0) return [];
  const isWeek = formsNoBracket(matches, (match) => match.advancesTo !== null);
  return cancelled.flatMap((match) => {
    if (!isWeek) return [`${describeMatchPlace(match)} is cancelled, but only a week's game can be: a bracket cannot lose a game`];
    if (match.result !== undefined || match.periodScores !== undefined) return [`${describeMatchPlace(match)} is cancelled, so it has no result and no period scores`];
    return [];
  });
}

/**
 * The field members a loaded bracket or week names in no match, which the release refuses
 * (`releaseBlockers`): a team on a bye is named on its later match, and a week's field is the
 * teams that play it, a postponed game kept as cancelled. Empty for an event with no matches.
 */
function unplacedFieldMembers(event: SportDataEvent, matches: readonly SportDataMatch[]): string[] {
  if (matches.length === 0) return [];
  const named = new Set(matches.flatMap((match) => match.sides.map((side) => side.player)));
  return event.field.filter((entry) => !named.has(entry.player)).map((entry) => entry.player);
}

/**
 * What is wrong with the matches left level (#787): only a week's game (an event of one round
 * whose games form no bracket), played to its end at level scores with no shoot-out, has no winner.
 */
function tieProblems(event: SportDataEvent, matches: readonly SportDataMatch[]): string[] {
  return matches.flatMap((match) => {
    const result = match.result;
    if (result?.winnerSideNumber !== null) return [];
    if (event.rounds > 1 || match.advancesTo !== null) return [`${describeMatchPlace(match)} has no winner, but a bracket match always has one`];
    const scores = result.sides.map((side) => side.score);
    const level = scores.every((score) => score !== null && score === scores[0]);
    const shootout = result.sides.some((side) => side.shootoutScore !== undefined);
    if (!level || shootout || result.ending !== undefined) return [`${describeMatchPlace(match)} has no winner, so it needs level scores, played to its end with no shoot-out`];
    return [];
  });
}

/**
 * What is wrong with the matches' period scores: no result, or a period twice or out of order.
 * Whether the game's slot keeps a score by period, and how many it has, is the server's to check
 * as the scores go in: a game's periods are its slot's (#2047).
 */
function periodScoreProblems(matches: readonly SportDataMatch[]): string[] {
  return matches.flatMap((match) => {
    const scores = match.periodScores ?? [];
    if (scores.length === 0) return [];
    const problems: string[] = [];
    if (match.result === undefined) problems.push(`${describeMatchPlace(match)} carries period scores but no result, and they are entered with its result`);
    if (scores.some((score, index) => index > 0 && score.periodNumber <= scores[index - 1].periodNumber)) {
      problems.push(`${describeMatchPlace(match)}'s period scores are not in period order, once each`);
    }
    return problems;
  });
}

/**
 * Reads a parsed JSON file as sport data, or throws SportDataFileError listing every problem:
 * an unknown schema version, a sport outside the registry, a file that is not test data, or
 * data outside the envelope's scope.
 */
export function parseSportDataFile(json: unknown): SportDataFile {
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
  const contents = new Set(file.scope.contents);
  const strokePlay = file.scope.scoringFamily === ScoringFamily.STROKE_PLAY;
  // A file's league plays matches when its scoring family plays HEAD_TO_HEAD slots (#2008), read
  // from the one table of each family's match formats.
  const playsBracket = isSport(sport) && (LEAGUE_PLAY_BY_SCORING_FAMILY[file.scope.scoringFamily].matchFormats as readonly MatchFormat[]).includes(MatchFormat.HEAD_TO_HEAD);
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
  const missing = TEST_SEED_CONTENTS.filter((content) => !contents.has(content));
  if (!slate && missing.length > 0) {
    problems.push(`testData needs ${TEST_SEED_CONTENTS.join(', ')} (a test seed), or just PLAYERS and FIELDS (a test slate); missing ${missing.join(', ')}.`);
  }
  if (!slate && playsBracket && !contents.has(SportDataContent.BRACKET)) {
    problems.push('A bracket sport\'s test seed needs BRACKET: its results are the bracket\'s match results.');
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
  const results = isSport(sport) ? SEED_RESULTS[file.scope.scoringFamily] : SeedResults.MATCH_RESULTS;
  for (const league of file.sportLeagues) checkLeague(league, file, strokePlay || !isSport(sport), playsBracket || !isSport(sport), results, problems);

  if (problems.length > 0 || !isSport(sport)) throw new SportDataFileError(problems);
  return { ...file, scope: { ...file.scope, sport } };
}
