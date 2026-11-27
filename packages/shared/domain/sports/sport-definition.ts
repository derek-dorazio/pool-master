import type { ParticipantScoringDefinitionId } from '../contest-scoring';
import type { SelectionType, Sport } from '../enums';

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
 * Everything that differs between sports and is data rather than behaviour. Behaviour that
 * differs (storing and scoring results) belongs to the sport's scoring family, never to a
 * comparison against the sport elsewhere (`rules/architecture-rules.md` §4 *Sport extension*).
 */
export interface SportDefinition {
  sport: Sport;
  /** The sport's name as a heading or menu entry reads it: "Golf", "Horse racing". */
  name: string;
  /** How many rounds an admin-authored event gets when the admin gives no count. */
  defaultRounds: number;
  /** Selection types a commissioner may choose for this sport. Each has an engine. */
  selectionTypes: readonly [SelectionType, ...SelectionType[]];
  /** Scoring definitions a contest in this sport may rank by; the first is the default. */
  scoringDefinitions: readonly [ParticipantScoringDefinitionId, ...ParticipantScoringDefinitionId[]];
  /**
   * What the sport's pick'em pools can be (#792). Present exactly when `selectionTypes` offers
   * PICK_EM: contest setup refuses a spread pool where it says no, and a tie pick is taken only
   * where it says yes.
   */
  pickEm?: SportPickEm;
}
