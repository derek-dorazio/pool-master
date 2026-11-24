import type { ParticipantScoringDefinitionId } from '../contest-scoring';
import type { MatchPeriodLayout, ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
import type { ScoringFamily } from './scoring-family';

/** A noun in its singular and plural, as the audience says it, read from the display strings. */
export interface SportNoun {
  one: string;
  many: string;
}

/**
 * What a sport's pick'em pools can be (#792): whether a pick may be a tie, and whether a pool
 * may be scored against the spread.
 */
export interface SportPickEm {
  /** Whether a pick'em pick may say the game ends level: soccer's draw. */
  tiePicks: boolean;
  /** Whether a pick'em pool may be scored against each game's spread (#720): not in soccer. */
  againstTheSpread: boolean;
}

/**
 * The periods one game is played in (#772): four quarters in American football. The score at the
 * end of each period but the last is entered on its own; the last period's is the final score.
 */
export interface SportMatchPeriods {
  /** How many periods a game has, overtime aside: 4 for American football. */
  count: number;
  /** What one period is called: "quarter" / "quarters", read from the display strings. */
  label: SportNoun;
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
  /** Selection types a commissioner may choose for this sport. Each has an engine. */
  selectionTypes: readonly [SelectionType, ...SelectionType[]];
  /**
   * Scoring definitions a contest in this sport may rank by; the first is the default. Empty while
   * the sport's family has no scoring definition yet (head to head until #699): its events can be
   * set up and released, but contest management refuses a contest on them.
   */
  scoringDefinitions: readonly ParticipantScoringDefinitionId[];
  /**
   * The periods a game is played in, for a sport that plays matches and keeps a score at the end
   * of each one (American football's quarters). A sport league may play another layout
   * (`SportLeague.matchPeriodLayout`: men's college basketball's halves); read both through
   * `matchPeriodsOf`. Absent for every other sport: its games take no period scores, and squares
   * pools (#711) are not offered on it.
   */
  matchPeriodLayout?: MatchPeriodLayout;
  /**
   * What the sport's pick'em pools can be (#792). Present exactly when `selectionTypes` offers
   * PICK_EM: contest setup refuses a spread pool where it says no, and a tie pick is taken only
   * where it says yes.
   */
  pickEm?: SportPickEm;
  /**
   * Whether a bracket match level after extra time is settled by a shoot-out (#791): penalties in
   * soccer; false for a sport whose knockout matches always end with one side ahead. A shoot-out
   * is entered only on a bracket match of such a sport (`MatchResultService`), and screens call it
   * by the sport's `shootout` word.
   */
  shootout: boolean;
  /**
   * How one round is labelled: "Round 2" for golf, "Quarterfinal" for tennis. A round with no
   * proper name reads a display string (`word.roundNumber`, `word.raceNumber`)
   * in the reader's locale.
   */
  roundLabel: (roundNumber: number, roundCount: number, locale?: string | null) => string;
}
