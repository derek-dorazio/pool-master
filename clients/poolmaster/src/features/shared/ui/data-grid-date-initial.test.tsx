import { createColumnHelper, type ColumnFiltersState } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataGrid } from "./data-grid";

// A date column that opens on a span, such as Activity's Started over the past day (#1887), and
// the grid telling its page which filters it shows, so the page can read the window they cover.

type Job = { id: string; queuedAt: string };

const HOUR_MS = 60 * 60_000;
const JOBS: Job[] = [
  { id: "recent", queuedAt: new Date(Date.now() - HOUR_MS).toISOString() },
  { id: "old", queuedAt: new Date(Date.now() - 3 * 24 * HOUR_MS).toISOString() },
];

const columnHelper = createColumnHelper<Job>();
const COLUMNS = [
  columnHelper.accessor("queuedAt", {
    id: "started",
    header: "Started",
    meta: { type: { kind: "datetime", direction: "past", initial: { kind: "relative", toward: "past", amount: 1, unit: "d" } } },
  }),
];

function renderGrid(onFiltersChange?: (filters: ColumnFiltersState) => void) {
  render(
    <DataGrid
      columns={COLUMNS}
      data={JOBS}
      emptyMessage="No jobs."
      filterTestIdPrefix="jobs-filter"
      getRowId={(job) => job.id}
      onFiltersChange={onFiltersChange}
      rowTestId={(job) => `row-${job.id}`}
    />,
  );
}

describe("DataGrid date column that opens on a span", () => {
  it("opens filtered to the past day, naming the filter, and shows everything once it is cleared", async () => {
    renderGrid();

    expect(screen.getByTestId("row-recent")).toBeInTheDocument();
    expect(screen.queryByTestId("row-old")).not.toBeInTheDocument();
    expect(screen.getByTestId("jobs-filter-summary")).toHaveTextContent("Past 1 day");

    await userEvent.click(screen.getByTestId("jobs-filter-summary-clear-all"));

    expect(screen.getByTestId("row-old")).toBeInTheDocument();
  });

  it("tells the page the filters it shows on its first render and after each change, the date span with the instants it covers", async () => {
    const onFiltersChange = vi.fn();
    const before = Date.now();
    renderGrid(onFiltersChange);

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    const [[first]] = onFiltersChange.mock.calls as [[ColumnFiltersState]];
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: "started", value: { kind: "date", span: { kind: "relative", toward: "past", amount: 1, unit: "d" } } });
    const { from } = first[0].value as { from: number };
    expect(from).toBeGreaterThanOrEqual(before - 24 * HOUR_MS - 1000);
    expect(from).toBeLessThanOrEqual(Date.now() - 24 * HOUR_MS);

    await userEvent.click(screen.getByTestId("jobs-filter-summary-clear-all"));

    expect(onFiltersChange).toHaveBeenLastCalledWith([]);
  });

  it("still shows a row that arrives after a Past span was applied, since the span reaches up to now", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const opened = Date.parse("2026-11-19T12:00:00.000Z");
      vi.setSystemTime(opened);
      const jobs = [
        { id: "recent", queuedAt: new Date(opened - HOUR_MS).toISOString() },
        { id: "old", queuedAt: new Date(opened - 3 * 24 * HOUR_MS).toISOString() },
      ];
      const grid = (data: Job[]) => (
        <DataGrid columns={COLUMNS} data={data} emptyMessage="No jobs." getRowId={(job) => job.id} rowTestId={(job) => `row-${job.id}`} />
      );
      const { rerender } = render(grid(jobs));

      vi.setSystemTime(opened + HOUR_MS);
      rerender(grid([{ id: "arrived", queuedAt: new Date(opened + 30 * 60_000).toISOString() }, ...jobs]));

      expect(screen.getByTestId("row-arrived")).toBeInTheDocument();
      expect(screen.queryByTestId("row-old")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
