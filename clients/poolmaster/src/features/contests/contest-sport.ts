import { formatParticipantStatusLabel, getSportDefinition, type Sport, type SportNoun, type SportVocabulary } from '@poolmaster/shared/domain';
import type { SelectionParticipant } from './contest-entry-selection';
import { getScoringFamilyUi } from './scoring-family-ui/registry';
import type { EntryTiebreakerUi } from './scoring-family-ui/types';

/**
 * What a contest's screens call a participant when the contest names no sport: the platform's
 * own word. Every contest created today runs on an event and so has a sport; this is the reading
 * of the `sport: null` the contest contract still allows, not a stand-in for one.
 */
const PARTICIPANT_WITHOUT_SPORT: SportNoun = { one: 'participant', many: 'participants' };

/** "golfer" for a golf contest, "horse" for a horse race: the contest's sport's word for a participant. */
export function contestParticipantNoun(sport: Sport | null | undefined): SportNoun {
  return sport ? getSportDefinition(sport).vocabulary.participant : PARTICIPANT_WITHOUT_SPORT;
}

/** What a contest's screens call one match when its sport names none (#704). */
const MATCH_WITHOUT_WORD: SportNoun = { one: 'game', many: 'games' };

/** What a contest's sport calls one match: "match" in tennis, "game" wherever the sport names none. */
export function contestMatchNoun(sport: Sport | null | undefined): SportNoun {
  return (sport ? getSportDefinition(sport).vocabulary.match : undefined) ?? MATCH_WITHOUT_WORD;
}

/**
 * The moment a contest's first match starts, read after "the": "first kickoff" in American
 * football, "first match" in tennis, "first game" for a contest with no sport.
 */
export function contestEventStart(sport: Sport | null | undefined): string {
  return sport ? getSportDefinition(sport).vocabulary.eventStart : 'first game';
}

/** What a match's score counts, as a tiebreaker reads it: "sets" in tennis, "points" wherever the sport names none. */
export function contestScoreUnit(sport: Sport | null | undefined): string {
  return (sport ? getSportDefinition(sport).vocabulary.scoreUnit : undefined) ?? 'points';
}

/** What a game that ends level is called (#792): "Draw" in soccer, "Tie" wherever the sport names none. */
export function tieWord(vocabulary: SportVocabulary | undefined): string {
  return vocabulary?.tie ?? 'Tie';
}

/** The tie word of a contest's sport, "Tie" for a contest with no sport. */
export function contestTieLabel(sport: Sport | null | undefined): string {
  return tieWord(sport ? getSportDefinition(sport).vocabulary : undefined);
}

/**
 * The tiebreaker a contest's entries predict, from its sport's scoring family: a golf entry's
 * winning score against par, none for a race. A contest with no sport asks for none.
 */
export function contestEntryTiebreaker(sport: Sport | null | undefined): EntryTiebreakerUi | null {
  return sport ? getScoringFamilyUi(getSportDefinition(sport)).entryTiebreaker : null;
}

/**
 * Why a participant cannot be picked, in the contest's sport's words: "Withdrawn" for a golfer,
 * "Scratched" for a horse.
 */
export function unavailableParticipantLabel(participant: SelectionParticipant, sport: Sport | null): string {
  return participant.status ? formatParticipantStatusLabel(participant.status, sport) : 'Unavailable';
}

/** A participant as the room names it: "(1) Duke" when the event seeds its field (#701), else the name. */
export function selectionParticipantLabel(participant: Pick<SelectionParticipant, 'participantName' | 'seedNumber'>) {
  return participant.seedNumber === null
    ? participant.participantName
    : `(${participant.seedNumber}) ${participant.participantName}`;
}
