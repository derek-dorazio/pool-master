import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { sportPathSegment } from '@poolmaster/shared/domain';
import { SPORTS_PATH } from './manage-navigation';
import { useSportEventQuery } from './use-sport-event';
import { useManagedSport } from './use-managed-sport';

/**
 * `/manage/sports/:sport/events/:eventId`: the event's pages read their words from the URL's
 * sport and their results card from the event's own, so a URL naming another sport than the
 * event's (only ever hand-typed) is sent to the same page under the event's own sport.
 */
export function ManageSportEventRoute() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const { sport } = useManagedSport();
  const { pathname, search } = useLocation();
  const event = useSportEventQuery(eventId).data;

  if (event && event.sport !== sport) {
    const ownSportPath = `${SPORTS_PATH}/${sportPathSegment(event.sport)}`;
    const rest = pathname.slice(`${SPORTS_PATH}/${sportPathSegment(sport)}`.length);
    return <Navigate replace to={`${ownSportPath}${rest}${search}`} />;
  }
  return <Outlet />;
}
