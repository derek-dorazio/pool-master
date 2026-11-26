import type { SportEventRoundMatchDto, SportEventParticipantDto } from '@/lib/api';
import { teamOn } from '@/lib/match-sides';

/** A field row as the bracket names it: "(1) Duke", or just the name when it has no seed. */
export function describeEntry(entry: SportEventParticipantDto): string {
  return entry.seedNumber === null ? entry.participant.name : `(${entry.seedNumber}) ${entry.participant.name}`;
}

/** The field row on one side of a match, if a team is named there. */
export function sideEntry(
  match: Pick<SportEventRoundMatchDto, 'sides'>,
  sideNumber: number,
  fieldById: ReadonlyMap<string, SportEventParticipantDto>,
): SportEventParticipantDto | undefined {
  const sportEventParticipantId = teamOn(match, sideNumber);
  return sportEventParticipantId === null ? undefined : fieldById.get(sportEventParticipantId);
}
