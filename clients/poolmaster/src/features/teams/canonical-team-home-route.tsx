import { Navigate, useLocation, useParams } from 'react-router-dom';
import { MyTeamPage } from './my-team-page';

export function CanonicalTeamHomeRoute() {
  const { teamId = '' } = useParams<{ teamId: string }>();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  if (teamId && searchParams.get('teamId') !== teamId) {
    searchParams.set('teamId', teamId);

    return (
      <Navigate
        replace
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- react-router types both Location.state and Navigate's state prop as `any`; this is an opaque passthrough, not a value this component inspects.
        state={location.state}
        to={`${location.pathname}?${searchParams.toString()}`}
      />
    );
  }

  return <MyTeamPage />;
}
