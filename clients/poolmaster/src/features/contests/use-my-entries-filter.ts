import { useSearchParams } from 'react-router';

/** The address's flag for the "My entries" filter (`?mine=1`), so a reload or a bookmark keeps it. */
const MY_ENTRIES_PARAM = 'mine';

/**
 * Whether a leaderboard shows only the viewer's entries (#1750), read from and written to the
 * address. Turning it on or off replaces the history entry rather than adding one, so Back still
 * leaves the page.
 */
export function useMyEntriesFilter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isOn = searchParams.get(MY_ENTRIES_PARAM) === '1';
  const setOn = (on: boolean) => {
    setSearchParams((params) => {
      if (on) {
        params.set(MY_ENTRIES_PARAM, '1');
      } else {
        params.delete(MY_ENTRIES_PARAM);
      }
      return params;
    }, { replace: true });
  };
  return { isOn, setOn };
}
