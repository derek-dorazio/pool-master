import { fireEvent, screen } from "@testing-library/react";

/** Opens a DataGrid column's filter by its funnel's test id, types the term and applies it. */
export function applyTextFilter(filterTestId: string, term: string) {
  fireEvent.click(screen.getByTestId(filterTestId));
  fireEvent.change(screen.getByTestId(`${filterTestId}-term`), { target: { value: term } });
  fireEvent.click(screen.getByTestId(`${filterTestId}-apply`));
}

/** Opens an enumerated DataGrid column's filter, ticks only the given values and applies it. */
export function applyEnumFilter(filterTestId: string, values: readonly string[]) {
  fireEvent.click(screen.getByTestId(filterTestId));
  // Tick every value first (Select all may start part-ticked), then untick them all.
  const selectAll = screen.getByTestId(`${filterTestId}-all`);
  if (!(selectAll as HTMLInputElement).checked) {
    fireEvent.click(selectAll);
  }
  fireEvent.click(selectAll);
  for (const value of values) {
    fireEvent.click(screen.getByTestId(`${filterTestId}-option-${value}`));
  }
  fireEvent.click(screen.getByTestId(`${filterTestId}-apply`));
}
