import type { ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';

/**
 * League codes are upper case, but the address people share shows them in lower case
 * (`buildLeagueWebAddress`). A lower or mixed case code in the address is sent on to the same
 * page under the upper case code, so every page below reads the one form the league holds.
 */
export function CanonicalLeagueCode({ children }: { children: ReactNode }) {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const location = useLocation();
  const canonical = leagueCode.toUpperCase();
  if (canonical === leagueCode) {
    return children;
  }
  const pathname = location.pathname.replace(`/league/${leagueCode}`, `/league/${canonical}`);
  return <Navigate replace state={location.state as unknown} to={`${pathname}${location.search}${location.hash}`} />;
}
