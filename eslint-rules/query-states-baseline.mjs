/**
 * Root admin files that still draw a query state by hand, grandfathered by
 * `poolmaster/no-hand-written-query-states` (#1588). The list only shrinks: move a file onto
 * QueryState/LoadingState/ErrorState (with onRetry) and delete its line. A file listed here that
 * has gone clean fails `scripts/query-states-baseline.test.mjs`, so the list cannot go stale and
 * hide a new hand-written state. Member pages are never added.
 */
export const QUERY_STATES_BASELINE = [
  'clients/poolmaster/src/features/root-admin/bracket-panel.tsx',
  'clients/poolmaster/src/features/root-admin/event-field-add-participants-modal.tsx',
  'clients/poolmaster/src/features/root-admin/event-field-grid-card.tsx',
  'clients/poolmaster/src/features/root-admin/golf-round-score-corrections-card.tsx',
  'clients/poolmaster/src/features/root-admin/golf-round-scores-panel.tsx',
  'clients/poolmaster/src/features/root-admin/manage-sport-route.tsx',
  'clients/poolmaster/src/features/root-admin/play-in-places-card.tsx',
  'clients/poolmaster/src/features/root-admin/race-finishing-order-panel.tsx',
  'clients/poolmaster/src/features/root-admin/root-admin-participant-create-page.tsx',
  'clients/poolmaster/src/features/root-admin/root-admin-run-event-sync-page.tsx',
  'clients/poolmaster/src/features/root-admin/root-admin-settings-page.tsx',
  'clients/poolmaster/src/features/root-admin/root-admin-sport-event-field-page.tsx',
  'clients/poolmaster/src/features/root-admin/root-admin-sport-event-tiers-page.tsx',
  'clients/poolmaster/src/features/root-admin/root-admin-sport-league-home-page.tsx',
  'clients/poolmaster/src/features/root-admin/root-admin-sport-overrides-page.tsx',
  'clients/poolmaster/src/features/root-admin/root-admin-user-page.tsx',
  'clients/poolmaster/src/features/root-admin/sport-event-score-source-card.tsx',
  'clients/poolmaster/src/features/root-admin/sport-league-calendar-card.tsx',
  'clients/poolmaster/src/features/root-admin/sport-league-event-calendar.tsx',
  'clients/poolmaster/src/features/root-admin/sport-league-roster-grid-card.tsx',
  'clients/poolmaster/src/features/root-admin/stat-lines-panel.tsx',
  'clients/poolmaster/src/features/root-admin/withdrawals-card.tsx',
];
