import { displayString, type DisplayStringValues, sportWord } from '@poolmaster/shared/display-strings';
import { eventSportDefinition, formatParticipantStatusLabel, type Sport, type SportLeagueDefinition, type SportNoun, sportNoun } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import type { SelectionParticipant } from './contest-entry-selection';
import { getScoringFamilyUi } from './scoring-family-ui/registry';
import type { EntryTiebreakerUi } from './scoring-family-ui/types';

/**
 * The definition a contest plays (#936): its events' sport league's. A contest covers one sport
 * league, so its first event's participant type and scoring family are every event's. Null for a
 * contest with no sport or no event: how a contest is scored is its sport league's fact (#2001),
 * read off its events, and without one there is no league to read it from. Every contest is
 * created on at least one event; the contest read lists none only when its events are gone.
 */
export function contestSportDefinition(contest: Pick<ContestDto, 'sport' | 'sportEvents'>): SportLeagueDefinition | null {
  const first = contest.sportEvents.at(0);
  if (!contest.sport || !first) {
    return null;
  }
  return eventSportDefinition({ sport: contest.sport, participantType: first.participantType, scoringFamily: first.scoringFamily });
}

/**
 * "team" in basketball, "golfer" in golf: what a roster contest's screens call one pick. It is the
 * sport's word, so a contest whose events are not listed keeps it. A contest with no sport reads
 * the generic word: every contest created today runs on an event and so has a sport; this is the
 * reading of the `sport: null` the contest contract still allows.
 */
export function contestRosterParticipantNoun(contest: Pick<ContestDto, 'sport' | 'sportEvents'>): SportNoun {
  return sportNoun(contest.sport ?? null, 'participant');
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
 * The tiebreaker a contest's entries predict, from its sport league's scoring family: a golf
 * entry's winning score against par, none for a race. A contest with no sport or no listed event
 * asks for none, since the family is read off its events.
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

/** The sport's words a game-picks screen's error wording takes (#700). */
export function gamePickErrorValues(sport: Sport | null | undefined): DisplayStringValues {
  const match = contestMatchNoun(sport);
  return {
    match: match.one,
    matches: match.many,
    participant: contestParticipantNoun(sport).one,
    scoreUnit: contestScoreUnit(sport),
  };
}
