import { ParticipantInactiveReason, type Sport } from '../enums';
import { getSportDefinition } from './registry';

/**
 * A participant status as the audience reads it: `ELIMINATED` and `WITHDRAWN` take the sport's
 * own words ("Cut" in golf; "Scratched" for a withdrawn horse); every other status is
 * title-cased. A sport with no word for eliminated (a race knocks nobody out) reads it
 * generically, as does any status without a sport. The audience's word is applied here, once,
 * for every surface that shows it.
 */
export function formatParticipantStatusLabel(status: string, sport?: Sport | null): string {
  if (sport) {
    const { vocabulary } = getSportDefinition(sport);
    if (status === ParticipantInactiveReason.ELIMINATED && vocabulary.eliminated !== undefined) {
      return vocabulary.eliminated;
    }
    if (status === ParticipantInactiveReason.WITHDRAWN) {
      return vocabulary.withdrawn;
    }
  }
  return status
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}
