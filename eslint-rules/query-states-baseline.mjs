/**
 * Root admin files that still draw a query state by hand, grandfathered by
 * `poolmaster/no-hand-written-query-states` (#1588). The list only shrinks: move a file onto
 * QueryState/LoadingState/ErrorState (with onRetry) and delete its line. A file listed here that
 * has gone clean fails `scripts/query-states-baseline.test.mjs`, so the list cannot go stale and
 * hide a new hand-written state. Member pages are never added.
 */
export const QUERY_STATES_BASELINE = [
  'clients/poolmaster/src/features/root-admin/event-field-add-participants-modal.tsx',
  'clients/poolmaster/src/features/root-admin/manage-sport-route.tsx',
  'clients/poolmaster/src/features/root-admin/root-admin-run-event-sync-page.tsx',
];
