import type { ParticipantScoringDefinitionId } from '../contest-scoring';
import type { ParticipantType, SelectionType, Sport, TournamentFormat } from '../enums';
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
  /** One scheduled stage of an event: "round" / "rounds". */
  round: SportNoun;
  /** The label for a participant knocked out of an event (`ELIMINATED`): "Cut" for golf. */
  eliminated: string;
  /** What the moment entries close is called: "first tee time" for golf. */
  eventStart: string;
}

/**
 * Everything that differs between sports and is data rather than behaviour. Behaviour that
 * differs (storing and scoring results) belongs to the sport's scoring family, never to a
 * comparison against the sport elsewhere (`rules/architecture-rules.md` §4 *Sport extension*).
 */
export interface SportDefinition {
  sport: Sport;
  participantType: ParticipantType;
  scoringFamily: ScoringFamily;
  /** The tournament format a new event of this sport gets. */
  tournamentFormat: TournamentFormat;
  /** Selection types a commissioner may choose for this sport. Each has an engine. */
  selectionTypes: readonly [SelectionType, ...SelectionType[]];
  /** Scoring definitions a contest in this sport may rank by; the first is the default. */
  scoringDefinitions: readonly [ParticipantScoringDefinitionId, ...ParticipantScoringDefinitionId[]];
  vocabulary: SportVocabulary;
  /** How one round is labelled: "Round 2" for golf, "Quarterfinal" for tennis. */
  roundLabel: (roundNumber: number, roundCount: number) => string;
}
