import { getSportDefinition, type Sport, type SportDefinition } from '@poolmaster/shared/domain';
import { useParams } from 'react-router-dom';
import { parseSportPathSegment } from './manage-navigation';

export type ManagedSport = {
  sport: Sport;
  definition: SportDefinition;
};

/** The sport a `/manage/sports/:sport/...` URL names, or null when it names no supported sport. */
export function useManagedSportParam(): ManagedSport | null {
  const sport = parseSportPathSegment(useParams()['sport']);
  return sport ? { sport, definition: getSportDefinition(sport) } : null;
}

/**
 * The sport of the Manage sport page being shown. Only pages under `ManageSportRoute` call it,
 * and that route renders them only for a supported sport, so a missing one is a routing bug.
 */
export function useManagedSport(): ManagedSport {
  const managed = useManagedSportParam();
  if (!managed) {
    throw new Error('useManagedSport is only available under a /manage/sports/:sport route.');
  }
  return managed;
}
