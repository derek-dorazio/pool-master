import { useState } from 'react';

/**
 * Which entry rows of a contest page are open (#1739): the viewer's own start open, everyone
 * else's closed, and a row the viewer opens or closes stays that way across the live polls.
 * Keyed by entry id, so an entry that first appears mid-session starts as its kind does.
 */
export function useOpenEntryRows(startOpenIds: readonly string[]) {
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const startOpen = new Set(startOpenIds);
  const isOpen = (entryId: string) => chosen.get(entryId) ?? startOpen.has(entryId);
  return {
    isOpen,
    /** Whether every one of `entryIds` is open: what Show all / Hide all details reads. */
    allOpen: (entryIds: readonly string[]) => entryIds.length > 0 && entryIds.every(isOpen),
    /** Opens or closes every one of `entryIds`. */
    setAll: (entryIds: readonly string[], open: boolean) => {
      setChosen((current) => new Map([...current, ...entryIds.map((entryId) => [entryId, open] as const)]));
    },
    toggle: (entryId: string) => {
      setChosen((current) => new Map(current).set(entryId, !isOpen(entryId)));
    },
    /** Opens one row, as Jump to my entry does. */
    open: (entryId: string) => {
      setChosen((current) => new Map(current).set(entryId, true));
    },
  };
}
