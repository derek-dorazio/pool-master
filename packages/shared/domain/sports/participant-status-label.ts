import { sportWord } from '../../display-strings/display-strings';
import { SportEventParticipantStatus, type Sport } from '../enums';

/**
 * A participant status as the audience reads it: `ELIMINATED` and `WITHDRAWN` take the sport's
 * own words ("Cut" in golf; "Scratched" for a withdrawn horse), or the generic word for a sport
 * with none; every other status is title-cased, as is any status without a sport. The audience's
 * word is applied here, once, for every surface that shows it.
 */
export function formatParticipantStatusLabel(status: string, sport?: Sport | null, locale?: string | null): string {
  if (sport) {
    if (status === SportEventParticipantStatus.ELIMINATED) return sportWord(sport, 'eliminated', { locale });
    if (status === SportEventParticipantStatus.WITHDRAWN) return sportWord(sport, 'withdrawn', { locale });
  }
  return status
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}
