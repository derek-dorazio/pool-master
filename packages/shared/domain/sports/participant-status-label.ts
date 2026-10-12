import { ParticipantInactiveReason, type Sport } from '../enums';
import { getSportDefinition } from './registry';

/**
 * A participant status as the audience reads it: `ELIMINATED` takes the sport's own word
 * ("Cut" in golf); every other status is title-cased. Without a sport it stays generic.
 * The audience's word is applied here, once, for every surface that shows it.
 */
export function formatParticipantStatusLabel(status: string, sport?: Sport | null): string {
  if (status === ParticipantInactiveReason.ELIMINATED && sport) {
    return getSportDefinition(sport).vocabulary.eliminated;
  }
  return status
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}
