import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

/** The address's entry to open on a contest page (`?entry=<entryId>`), as an email or a shared link names it. */
const LINKED_ENTRY_PARAM = 'entry';

/**
 * The entry a link opened the contest page on (#1762): `entryId` is the one `?entry=` names, if
 * any, and `clear` drops it from the address once the viewer closes that entry. Clearing
 * replaces the history entry rather than adding one, so Back still leaves the page. Each board
 * decides whether the entry is one it shows; an id it doesn't show is ignored.
 */
export function useLinkedEntry() {
  const [searchParams, setSearchParams] = useSearchParams();
  const entryId = searchParams.get(LINKED_ENTRY_PARAM);
  const clear = () => {
    if (entryId === null) {
      return;
    }
    setSearchParams((params) => {
      params.delete(LINKED_ENTRY_PARAM);
      return params;
    }, { replace: true });
  };
  return { entryId, clear };
}

/**
 * Lands a page on one entry once (#1762). `landOn` is called while rendering with the linked
 * entry once the page knows it shows it: the first time for that id it runs `onLand` (to open
 * the entry or turn to its page), and after that render the page scrolls to the element marked
 * `data-entry-id` with it, where there is one. Later renders, such as a live poll, leave the
 * viewer where they are.
 */
export function useLandOnEntry() {
  const [landedId, setLandedId] = useState<string | null>(null);
  useEffect(() => {
    if (landedId === null) {
      return;
    }
    document.querySelector(`[data-entry-id="${CSS.escape(landedId)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [landedId]);
  return (entryId: string | null, onLand?: () => void) => {
    if (entryId !== null && entryId !== landedId) {
      setLandedId(entryId);
      onLand?.();
    }
  };
}
