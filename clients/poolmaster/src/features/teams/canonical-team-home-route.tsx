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
        state={location.state}
        to={`${location.pathname}?${searchParams.toString()}`}
      />
    );
  }

  return <MyTeamPage />;
}
