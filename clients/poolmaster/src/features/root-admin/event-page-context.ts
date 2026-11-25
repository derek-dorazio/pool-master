import { useOutletContext } from 'react-router';
import type { SportEventDto, SportEventOverviewDto, SportLeagueDto } from '@/lib/api';
import type { ActivityState } from './use-activity';

/** The Event page's tabs, in order (the Event page spec). */
export const EVENT_PAGE_TABS = [
  { segment: 'field', label: 'Field' },
  { segment: 'rounds', label: 'Rounds and matches' },
  { segment: 'contests', label: 'Contests' },
  { segment: 'activity', label: 'Activity' },
] as const;

export type EventPageTab = (typeof EVENT_PAGE_TABS)[number]['segment'];

/** What every tab of the Event page is about: the event, its overview once read, and its league. */
export type EventPageContext = {
  event: SportEventDto;
  overview: SportEventOverviewDto | undefined;
  sportLeague: SportLeagueDto | undefined;
  /** Whether a provider syncs the event's league. */
  isSynced: boolean;
  /** The event's jobs, read once for the Activity tab's grid and the failed count on its tab. */
  activity: ActivityState;
};

/** The Event page context, for a tab under `EventPageLayout`. */
export function useEventPage(): EventPageContext {
  return useOutletContext<EventPageContext>();
}
