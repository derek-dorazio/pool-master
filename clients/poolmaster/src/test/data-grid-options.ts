import type { DataGridOption } from "../features/shared/ui/data-grid-filters";

/** An enumerated column's values for a test or story grid, from a map of each value to its words, in the map's order. */
export function optionsFromLabels(labels: Readonly<Record<string, string>>): DataGridOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}
