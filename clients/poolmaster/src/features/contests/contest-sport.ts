import { displayString, sportWord } from '@poolmaster/shared/display-strings';
import { eventSportDefinition, formatParticipantStatusLabel, type Sport, type SportDefinition, type SportNoun, sportNoun } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import type { SelectionParticipant } from './contest-entry-selection';
import { getScoringFamilyUi } from './scoring-family-ui/registry';
import type { EntryTiebreakerUi } from './scoring-family-ui/types';

/**
 * The definition a contest plays (#936): its events' sport league's, so a World Series stat pool
 * plays baseball's composite with players, not its bracket. A contest covers one sport league, so
 * its first event's overrides are every event's. Null for a contest with no sport.
 */
export function contestSportDefinition(contest: Pick<ContestDto, 'sport' | 'sportEvents'>): SportDefinition | null {
  if (!contest.sport) {
    return null;
  }
  const first = contest.sportEvents.at(0);
  return eventSportDefinition({ sport: contest.sport, participantType: first?.participantType, scoringFamily: first?.scoringFamily });
}

/**
 * "player" in a stat pool, "golfer" in golf: what a roster contest's screens call one pick. A
 * contest with no sport reads the generic word: every contest created today runs on an event and
 * so has a sport; this is the reading of the `sport: null` the contest contract still allows.
 */
export function contestRosterParticipantNoun(contest: Pick<ContestDto, 'sport' | 'sportEvents'>): SportNoun {
  return sportNoun(contestSportDefinition(contest), 'participant');
}

/** "golfer" for a golf contest, "horse" for a horse race: the contest's sport's word for a participant. */
export function contestParticipantNoun(sport: Sport | null | undefined): SportNoun {
  return sportNoun(sport ?? null, 'participant');
}

/**
 * What a contest's sport calls one match: "match" in tennis, "game" in basketball (#704). A
 * contest with no sport says "game".
 */
export function contestMatchNoun(sport: Sport | null | undefined): SportNoun {
  return sport ? sportNoun(sport, 'match') : sportNoun(null, 'game');
}

/**
 * The moment a contest's first match starts, read after "the": "first kickoff" in American
 * football, "first match" in tennis, "first game" for a contest with no sport.
 */
export function contestEventStart(sport: Sport | null | undefined): string {
  return sport ? sportWord(sport, 'eventStart') : displayString('word.firstGame');
}

/** What a match's score counts, as a tiebreaker reads it: "sets" in tennis, "points" wherever the sport names none. */
export function contestScoreUnit(sport: Sport | null | undefined): string {
  return sportWord(sport ?? null, 'scoreUnit');
}

/** The tie word of a contest's sport (#792): "Draw" in soccer, "Tie" wherever the sport names none. */
export function contestTieLabel(sport: Sport | null | undefined): string {
  return sportWord(sport ?? null, 'tie');
}

/**
 * The tiebreaker a contest's entries predict, from its scoring family: a golf entry's winning
 * score against par, none for a race or a stat pool. A contest with no sport asks for none.
 */
export function contestEntryTiebreaker(contest: Pick<ContestDto, 'sport' | 'sportEvents'>): EntryTiebreakerUi | null {
  const definition = contestSportDefinition(contest);
  return definition ? getScoringFamilyUi(definition).entryTiebreaker : null;
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

/**
 * Who a participant plays for, with their position when it is known, as a roster row's second
 * line: "Los Angeles Dodgers · SS" for a stat pool player (#936). Null for a participant with no
 * team, such as a golfer.
 */
export function participantAffiliation(participant: Pick<SelectionParticipant, 'team' | 'role'>): string | null {
  if (!participant.team) {
    return null;
  }
  return participant.role ? `${participant.team} · ${participant.role}` : participant.team;
}
