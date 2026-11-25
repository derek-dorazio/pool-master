import { enumLabel } from '@poolmaster/shared/display-strings';
import { MatchEnding, MatchSide } from '@poolmaster/shared/domain';
import type { SportEventRoundMatchDto, SportEventParticipantDto } from '@/lib/api';

/**
 * How a match that stopped early is marked beside its result (#704): the ending's short display
 * string, "ret.", "w/o", "def.". The marks belong to the ending, not the sport. A played match has none.
 */
export function matchEndingMark(ending: MatchEnding): string | null {
  return ending === MatchEnding.PLAYED ? null : enumLabel('MatchEnding', ending, { form: 'short' });
}

/** A field row as the bracket names it: "(1) Duke", or just the name when it has no seed. */
export function describeEntry(entry: SportEventParticipantDto): string {
  return entry.seedNumber === null ? entry.participant.name : `(${entry.seedNumber}) ${entry.participant.name}`;
}

/** The field row on one side of a match, if a team is named there. */
export function sideEntry(
  match: SportEventRoundMatchDto,
  side: MatchSide,
  fieldById: ReadonlyMap<string, SportEventParticipantDto>,
): SportEventParticipantDto | undefined {
  const sportEventParticipantId = side === MatchSide.HOME ? match.homeSportEventParticipantId : match.awaySportEventParticipantId;
  return sportEventParticipantId === null ? undefined : fieldById.get(sportEventParticipantId);
}
