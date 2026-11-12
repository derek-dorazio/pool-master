/** A query `refetchFailed` can run again. */
type Refetchable = { isError: boolean; refetch: () => unknown };

/**
 * Retry for a page that waits on several reads: runs again only the ones that failed, so a page
 * whose contest loaded but whose league did not reloads just the league.
 */
export function refetchFailed(...queries: Refetchable[]): () => void {
  return () => {
    for (const query of queries) {
      if (query.isError) void query.refetch();
    }
  };
}
