/**
 * Files that still restyle a `Button` through its `className`, grandfathered by
 * `poolmaster/no-button-style-override` (#1615). The list only shrinks: give the button the look
 * through `variant`, `size` or `layout` (or a new variant in `shared/ui/button.tsx`) and delete
 * its line. A file listed here that has gone clean fails `scripts/button-style-baseline.test.mjs`,
 * so the list cannot go stale and hide a new override. Nothing is ever added.
 */
export const BUTTON_STYLE_BASELINE = [
  'clients/poolmaster/src/features/championships/championship-standings-grid.tsx',
  'clients/poolmaster/src/features/contests/contest-entry-budget.tsx',
  'clients/poolmaster/src/features/contests/contest-entry-selection.tsx',
  'clients/poolmaster/src/features/contests/squares-grid.tsx',
  'clients/poolmaster/src/features/leagues/league-menu-bar.tsx',
  'clients/poolmaster/src/features/root-admin/tier-board.tsx',
  'clients/poolmaster/src/features/root-admin/tier-definitions-panel.tsx',
];
