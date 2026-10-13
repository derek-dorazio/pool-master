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
  /** One event a contest runs on: "tournament" / "tournaments" for golf, "race" / "races" for horse racing. */
  event: SportNoun;
  /**
   * One sport league, the organiser whose events recur each year: "tour" / "tours" for golf (the
   * PGA Tour), "circuit" / "circuits" for horse racing (US Thoroughbred), "series" / "series" for
   * auto racing (NASCAR Cup Series).
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
  /** What the moment entries close is called: "first tee time" for golf. */
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
  /** The tiers a new event gets, and the tier size auto-assignment uses when none is sent. */
  defaultTierLayout: SportTierLayout;
  /** Selection types a commissioner may choose for this sport. Each has an engine. */
  selectionTypes: readonly [SelectionType, ...SelectionType[]];
  /** Scoring definitions a contest in this sport may rank by; the first is the default. */
  scoringDefinitions: readonly [ParticipantScoringDefinitionId, ...ParticipantScoringDefinitionId[]];
  vocabulary: SportVocabulary;
  /** How one round is labelled: "Round 2" for golf, "Quarterfinal" for tennis. */
  roundLabel: (roundNumber: number, roundCount: number) => string;
}
