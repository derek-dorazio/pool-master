import { formatParticipantStatusLabel, getSportDefinition, type Sport, type SportNoun } from '@poolmaster/shared/domain';
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

/** What a game that ends level is called (#792): "Draw" in soccer, "Tie" wherever the sport names none. */
export function contestTieLabel(sport: Sport | null | undefined): string {
  return (sport ? getSportDefinition(sport).vocabulary.tie : undefined) ?? 'Tie';
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
