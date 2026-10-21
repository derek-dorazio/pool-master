import type { ParticipantScoringDefinitionId } from '../contest-scoring';
import type { MatchPeriodLayout, ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import type { ScoringFamily } from './scoring-family';

/** A noun in its singular and plural, as the audience says it. */
export interface SportNoun {
  one: string;
  many: string;
}

/** What a sport's audience calls things. Shared screens read these instead of saying "golfer". */
export interface SportVocabulary {
  /** One competitor: "golfer" / "golfers". */
  participant: SportNoun;
  /** One event a contest runs on: "tournament" / "tournaments" for golf, "race" / "races" for horse racing. */
  event: SportNoun;
  /**
   * One sport league, the organiser whose events recur each year: "tour" / "tours" for golf (the
   * PGA Tour), "circuit" / "circuits" for horse racing (US Thoroughbred), "series" / "series" for
   * auto racing (NASCAR Cup Series), "tour" / "tours" for cycling (UCI WorldTour), "series" /
   * "series" for running (World Marathon Majors).
   */
  sportLeague: SportNoun;
  /** One scheduled stage of an event: "round" / "rounds". */
  round: SportNoun;
  /**
   * The label for a participant knocked out of an event (`ELIMINATED`): "Cut" for golf. Absent
   * for a sport where nobody is knocked out partway (a race): its readers handle the absence.
   */
  eliminated?: string;
  /** The label for a participant withdrawn from an event (`WITHDRAWN`): "Withdrawn" for golf, "Scratched" for horse racing. */
  withdrawn: string;
  /**
   * What the moment entries close is called: "first tee time" for golf, "start" for cycling. Copy
   * reads it after "the" ("Entries close at the first tee time"), so it carries no article.
   */
  eventStart: string;
  /**
   * Who rides or drives each participant, as a race result's column header: "Rider" for horse
   * racing. Absent for a sport whose result names nobody besides the participant (golf).
   */
  rider?: string;
  /**
   * What the audience calls the first three finishing places, as the points table's hint:
   * "Win / Place / Show" for horse racing. Absent for a sport with no such name.
   */
  topPlaces?: string;
  /**
   * One head-to-head match of the event's bracket: "game" / "games" for basketball. Absent for a
   * sport that plays no bracket; a bracket screen of a sport without one says "match".
   */
  match?: SportNoun;
}

/**
 * The periods one game is played in (#772): four quarters in American football. The score at the
 * end of each period but the last is entered on its own; the last period's is the final score.
 */
export interface SportMatchPeriods {
  /** How many periods a game has, overtime aside: 4 for American football. */
  count: number;
  /** What one period is called: "quarter" / "quarters". */
  label: SportNoun;
}

/**
 * How a sport settles a knockout match level after extra time by a shoot-out (#791): penalties
 * in soccer. The shoot-out's scores are kept apart from the match score.
 */
export interface SportShootout {
  /** What a result's shoot-out is called after its scores: "pens" ("1-1 (4-3 pens)"). */
  label: string;
}

/** How a new event's pick tiers are laid out before an admin edits them. */
export interface SportTierLayout {
  /** How many tiers a new event gets. */
  tierCount: number;
  /** How many participants auto-assignment places in each tier; the last tier takes the rest. */
  tierSize: number;
}

/**
 * Everything that differs between sports and is data rather than behaviour. Behaviour that
 * differs (storing and scoring results) belongs to the sport's scoring family, never to a
 * comparison against the sport elsewhere (`rules/architecture-rules.md` §4 *Sport extension*).
 */
export interface SportDefinition {
  sport: Sport;
  /** The sport's name as a heading or menu entry reads it: "Golf", "Horse racing". */
  name: string;
  participantType: ParticipantType;
  scoringFamily: ScoringFamily;
  /** The tournament format a new event of this sport gets. */
  tournamentFormat: TournamentFormat;
  /** How many rounds an admin-authored event gets when the admin gives no count. */
  defaultRounds: number;
  /**
   * The tiers a new event gets, and the tier size auto-assignment uses when none is sent and
   * the event still has this many tiers (any other count is spread evenly).
   */
  defaultTierLayout: SportTierLayout;
  /** Selection types a commissioner may choose for this sport. Each has an engine. */
  selectionTypes: readonly [SelectionType, ...SelectionType[]];
  /**
   * Scoring definitions a contest in this sport may rank by; the first is the default. Empty while
   * the sport's family has no scoring definition yet (head to head until #699): its events can be
   * set up and released, but contest management refuses a contest on them.
   */
  scoringDefinitions: readonly ParticipantScoringDefinitionId[];
  vocabulary: SportVocabulary;
  /**
   * The periods a game is played in, for a sport that plays matches and keeps a score at the end
   * of each one (American football's quarters). A sport league may play another layout
   * (`SportLeague.matchPeriodLayout`: men's college basketball's halves); read both through
   * `matchPeriodsOf`. Absent for every other sport: its games take no period scores, and squares
   * pools (#711) are not offered on it.
   */
  matchPeriodLayout?: MatchPeriodLayout;
  /**
   * Whether a bracket match level after extra time is settled by a shoot-out, and what screens
   * call it; null for a sport whose knockout matches always end with one side ahead. A shoot-out
   * is entered only on a bracket match of such a sport (`MatchResultService`).
   */
  shootout: SportShootout | null;
  /** How one round is labelled: "Round 2" for golf, "Quarterfinal" for tennis. */
  roundLabel: (roundNumber: number, roundCount: number) => string;
}
