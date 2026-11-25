import { useOutletContext } from 'react-router';
import type { SportLeagueDto, SportLeagueOverviewDto } from '@/lib/api';
import type { ActivityState } from './use-activity';

/** The League page's tabs, in order (the League page spec). */
export const LEAGUE_PAGE_TABS = [
  { segment: 'events', label: 'Events' },
  { segment: 'participants', label: 'Participants' },
  { segment: 'activity', label: 'Activity' },
  { segment: 'contest-templates', label: 'Contest templates' },
  { segment: 'structure', label: 'Structure' },
] as const;

export type LeaguePageTab = (typeof LEAGUE_PAGE_TABS)[number]['segment'];

/** What every tab of the League page is about: the league, and its Sports page row once read. */
export type LeaguePageContext = {
  sportLeague: SportLeagueDto;
  overview: SportLeagueOverviewDto | undefined;
  /** Whether a provider syncs the league's events. */
  isSynced: boolean;
  /** The league's jobs, read once for the Activity tab's grid and the failed count on its tab. */
  activity: ActivityState;
};

/** Whether a provider syncs the league's events, from its overview row once read, else its own setting. */
export function isSyncedLeague(sportLeague: Pick<SportLeagueDto, 'selectedProviderMapping'>, overview: Pick<SportLeagueOverviewDto, 'providerId'> | undefined): boolean {
  return (overview === undefined ? sportLeague.selectedProviderMapping : overview.providerId) !== null;
}

/** The League page context, for a tab under `LeaguePageLayout`. */
export function useLeaguePage(): LeaguePageContext {
  return useOutletContext<LeaguePageContext>();
}
