import { useSearchParams } from 'react-router';

/** The address's flag for the "My entries" filter (`?mine=1`), so a reload or a bookmark keeps it. */
const MY_ENTRIES_PARAM = 'mine';

/**
 * Whether a leaderboard's "My entries" filter (#1750) is on, read from and written to the
 * address. Turning it on or off replaces the history entry rather than adding one, so Back still
 * leaves the page. `narrowToMyEntries` applies it.
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

/**
 * The one place every board narrows to the viewer's entries (#1750): `rows` is the board to show,
 * the viewer's alone (each keeping its place) while the filter is on and they have one, and
 * `hasMine` says whether to offer the switch at all. A filter left on for a viewer with no entry
 * shows the whole board rather than an empty one.
 */
export function narrowToMyEntries<Row>(allRows: Row[], isMine: (row: Row) => boolean, isOn: boolean) {
  const mine = allRows.filter(isMine);
  const showsMineOnly = isOn && mine.length > 0;
  return { hasMine: mine.length > 0, rows: showsMineOnly ? mine : allRows, showsMineOnly };
}
