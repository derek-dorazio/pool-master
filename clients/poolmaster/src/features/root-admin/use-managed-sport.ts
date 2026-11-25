import type { Sport } from '@poolmaster/shared/domain';
import { useParams } from 'react-router';
import { useSportsQuery } from './use-sport-catalog';

export type ManagedSport = {
  sport: Sport;
  /** The sport's stored URL segment, as `/manage/sports/:sport` names it. */
  sportUrlSegment: string;
};

/**
 * The sport a `/manage/sports/:sport/...` URL names, looked up by its stored URL segment among
 * the platform's sports: `managed` is null while they load, when they fail, or when the segment
 * names none.
 */
export function useManagedSportParam() {
  const segment = useParams()['sport'];
  const sportsQuery = useSportsQuery();
  // poolmaster-allow-list-lookup: the platform's dozen sports, matched by the address's segment
  const row = sportsQuery.data?.find((candidate) => candidate.urlSegment === segment);
  const managed: ManagedSport | null = row
    ? { sport: row.sport, sportUrlSegment: row.urlSegment }
    : null;
  return { managed, sportsQuery };
}

/**
 * The sport of the Manage sport page being shown. Only pages under `ManageSportRoute` call it,
 * and that route renders them only once the sport is found, so a missing one is a routing bug.
 */
export function useManagedSport(): ManagedSport {
  const { managed } = useManagedSportParam();
  if (!managed) {
    throw new Error('useManagedSport is only available under a /manage/sports/:sport route.');
  }
  return managed;
}
