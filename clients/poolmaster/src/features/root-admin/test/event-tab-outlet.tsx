import { Outlet, useParams } from 'react-router';
import type { SportEventOverviewDto } from '@/lib/api';
import type { EventPageContext } from '../event-page-context';
import { useActivity } from '../use-activity';
import { useSportEventQuery } from '../use-sport-event';

/**
 * Test-only stand-in for `EventPageLayout`: reads the route's event and hands an Event page tab
 * the context the page would, without the header's other reads, so a tab's test mocks only what
 * the tab itself reads. Nothing renders until the event has loaded.
 */
export function EventTabOutlet({ isSynced = false, overview }: { isSynced?: boolean; overview?: SportEventOverviewDto }) {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const eventQuery = useSportEventQuery(eventId);
  const activity = useActivity({ sportEventId: eventId }, { poll: false });
  if (eventQuery.data === undefined) return null;
  const context: EventPageContext = { event: eventQuery.data, overview, sportLeague: undefined, isSynced, activity };
  return <Outlet context={context} />;
}
