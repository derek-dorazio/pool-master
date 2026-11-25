import { Sport, alphabeticalOrder, explicitOrder } from "@poolmaster/shared/domain";

/** The sports' display order as the API gives it (SportDto.displayOrder). */
const SPORT_DISPLAY_ORDER = explicitOrder<string>({ AMERICAN_FOOTBALL: 0, BASKETBALL: 1, BASEBALL: 2, HOCKEY: 3, SOCCER: 4, GOLF: 5, AUTO_RACING: 6, TENNIS: 7, HORSE_RACING: 8, CYCLING: 9, RUNNING: 10 });
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataGrid } from "./data-grid";

type Row = {
  id: string;
  name: string;
  members: number | null;
  active: boolean | null;
  sport: string;
  starts: string | null;
  season: { start: string | null; end: string | null } | null;
};

const ROWS: Row[] = [
  { id: "a", name: "Alpha", members: 9, active: true, sport: Sport.GOLF, starts: "2026-11-02T15:00:00.000Z", season: { start: "2026-10-21", end: "2027-06-18" } },
  { id: "b", name: "Bravo", members: 120, active: false, sport: Sport.BASKETBALL, starts: "2026-11-18T14:00:00.000Z", season: { start: "2027-03-25", end: "2027-11-01" } },
  { id: "c", name: "Charlie", members: 10, active: null, sport: Sport.AMERICAN_FOOTBALL, starts: null, season: { start: "2026-09-01", end: null } },
  { id: "d", name: "Delta", members: null, active: true, sport: Sport.HOCKEY, starts: "2026-12-05T00:30:00.000Z", season: null },
];

const helper = createColumnHelper<Row>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COLUMNS: ColumnDef<Row, any>[] = [
  helper.accessor("name", { header: "Name", meta: { type: { kind: "text" } } }),
  helper.accessor("members", { header: "Members", meta: { type: { kind: "number" } } }),
  helper.accessor("active", { header: "Active", meta: { type: { kind: "boolean", nullable: true } } }),
  helper.accessor("sport", { header: "Sport", meta: { type: { kind: "enum", order: SPORT_DISPLAY_ORDER } } }),
  helper.accessor("starts", { header: "Starts", meta: { type: { kind: "datetime", direction: "both" } } }),
  helper.accessor("season", { header: "Season", meta: { type: { kind: "dateRange", direction: "both" } } }),
  helper.display({ id: "actions", header: "Actions", cell: () => "…" }),
];

function renderGrid(columns: ColumnDef<Row>[] = COLUMNS) {
  render(
    <DataGrid
      columns={columns}
      data={ROWS}
      emptyMessage="No rows."
      getRowId={(row) => row.id}
      rowTestId={(row) => `row-${row.id}`}
    />,
  );
}

function shownRows() {
  return screen.queryAllByTestId(/^row-/).map((row) => row.getAttribute("data-testid")?.slice(4));
}

function sortBy(columnId: string, times = 1) {
  for (let click = 0; click < times; click += 1) {
    fireEvent.click(screen.getByTestId(`data-grid-sort-${columnId}`));
  }
}

function openFilter(columnId: string) {
  fireEvent.click(screen.getByTestId(`data-grid-filter-${columnId}`));
}

function apply(columnId: string) {
  fireEvent.click(screen.getByTestId(`data-grid-filter-${columnId}-apply`));
}

function summary() {
  return screen.getByTestId("data-grid-filter-summary").textContent;
}

beforeEach(() => {
  // Wednesday 18 November 2026, 10:30 AM in New York, the default display zone.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T15:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a column with no type", () => {
  it("neither sorts nor filters", () => {
    renderGrid();

    expect(screen.queryByTestId("data-grid-sort-actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("data-grid-filter-actions")).not.toBeInTheDocument();
  });
});

describe("text columns", () => {
  it("match Contains by default, or Starts with from the match button, ignoring case", () => {
    renderGrid();

    openFilter("name");
    fireEvent.change(screen.getByTestId("data-grid-filter-name-term"), { target: { value: "HAR" } });
    apply("name");
    expect(shownRows()).toEqual(["c"]);
    expect(summary()).toContain("Name (contains “HAR”)");

    openFilter("name");
    fireEvent.change(screen.getByTestId("data-grid-filter-name-match"), { target: { value: "startsWith" } });
    fireEvent.change(screen.getByTestId("data-grid-filter-name-term"), { target: { value: "b" } });
    apply("name");
    expect(shownRows()).toEqual(["b"]);
    expect(summary()).toContain("Name (starts with “b”)");
  });

  it("open the popup with the box focused, ready to type", () => {
    renderGrid();

    openFilter("name");

    expect(screen.getByTestId("data-grid-filter-name-term")).toHaveFocus();
  });
});

describe("number columns", () => {
  it("sort by size, not as words (9 before 10 before 120), blanks last, and sit right-aligned", () => {
    renderGrid();

    sortBy("members");
    expect(shownRows()).toEqual(["a", "c", "b", "d"]);
    sortBy("members");
    expect(shownRows()).toEqual(["b", "c", "a", "d"]);
    expect(screen.getByRole("columnheader", { name: /Members/ })).toHaveClass("text-right");
    expect(within(screen.getByTestId("row-a")).getByText("9")).toHaveClass("text-right", "tabular-nums");
  });

  it.each([
    ["between", { from: "10", to: "100" }, ["c"], "Members (10 to 100)"],
    ["between", { from: "10" }, ["b", "c"], "Members (≥ 10)"],
    ["between", { to: "10" }, ["a", "c"], "Members (≤ 10)"],
    ["equals", { from: "120" }, ["b"], "Members (= 120)"],
    ["notEqual", { from: "120" }, ["a", "c"], "Members (≠ 120)"],
    ["blank", {}, ["d"], "Members (blank)"],
    ["notBlank", {}, ["a", "b", "c"], "Members (not blank)"],
  ])("filter %s %j to the rows that match", (match, bounds: { from?: string; to?: string }, rows, named) => {
    renderGrid();

    openFilter("members");
    fireEvent.change(screen.getByTestId("data-grid-filter-members-match"), { target: { value: match } });
    if (bounds.from !== undefined) fireEvent.change(screen.getByTestId("data-grid-filter-members-from"), { target: { value: bounds.from } });
    if (bounds.to !== undefined) fireEvent.change(screen.getByTestId("data-grid-filter-members-to"), { target: { value: bounds.to } });
    apply("members");

    expect(shownRows()).toEqual(rows);
    expect(summary()).toContain(named);
  });

  it("keep Apply off until Between has a bound or Equals a value", () => {
    renderGrid();

    openFilter("members");
    expect(screen.getByTestId("data-grid-filter-members-apply")).toBeDisabled();
    fireEvent.change(screen.getByTestId("data-grid-filter-members-from"), { target: { value: "abc" } });
    expect(screen.getByTestId("data-grid-filter-members-apply")).toBeDisabled();
    fireEvent.change(screen.getByTestId("data-grid-filter-members-from"), { target: { value: "5" } });
    expect(screen.getByTestId("data-grid-filter-members-apply")).toBeEnabled();
  });
});

describe("yes/no columns", () => {
  it("write Yes and No, sort Yes first, and filter by ticked answers, (Blank) only when the column is nullable", () => {
    renderGrid();

    expect(screen.getByTestId("row-a")).toHaveTextContent("Yes");
    expect(screen.getByTestId("row-b")).toHaveTextContent("No");
    sortBy("active");
    expect(shownRows()).toEqual(["a", "d", "b", "c"]);

    openFilter("active");
    expect(screen.getByTestId(`data-grid-filter-active-option-\u0000none`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("data-grid-filter-active-option-true"));
    apply("active");
    expect(shownRows()).toEqual(["b", "c"]);
    expect(summary()).toContain("Active (No or (Blank))");
  });

  it("offer no (Blank) on a column that is never blank", () => {
    renderGrid([helper.accessor("active", { header: "Active", meta: { type: { kind: "boolean" } } })]);

    openFilter("active");

    expect(screen.queryByTestId(`data-grid-filter-active-option-\u0000none`)).not.toBeInTheDocument();
  });
});

describe("enum columns", () => {
  it("list and sort a shared enum in its declared order (#1841), not A to Z", () => {
    renderGrid();

    sortBy("sport");
    expect(shownRows()).toEqual(["c", "b", "d", "a"]);
    openFilter("sport");
    const listed = screen.getAllByTestId(/^data-grid-filter-sport-option-/).map((box) => box.getAttribute("data-testid")?.slice(30));
    expect(listed.slice(0, 4)).toEqual([Sport.AMERICAN_FOOTBALL, Sport.BASKETBALL, Sport.BASEBALL, Sport.HOCKEY]);
  });

  it("sort an alphabetical enum A to Z by its words", () => {
    const words: Record<string, string> = { GOLF: "Zebra", BASKETBALL: "Apple", AMERICAN_FOOTBALL: "Mango", HOCKEY: "Kiwi" };
    renderGrid([
      helper.accessor("sport", { header: "Sport", meta: { type: { kind: "enum", order: alphabeticalOrder("Sport"), label: (value) => words[value] } } }),
    ]);

    sortBy("sport");

    expect(shownRows()).toEqual(["b", "d", "c", "a"]);
  });
});

describe("date and time columns", () => {
  it("write each date padded in the member's zone and sort by the instant, blanks last", () => {
    renderGrid();

    expect(screen.getByTestId("row-a")).toHaveTextContent("Nov 02, 2026, 10:00 AM");
    expect(screen.getByTestId("row-d")).toHaveTextContent("Dec 04, 2026, 07:30 PM");
    sortBy("starts");
    expect(shownRows()).toEqual(["a", "b", "d", "c"]);
    sortBy("starts");
    expect(shownRows()).toEqual(["d", "b", "a", "c"]);
  });

  it("filter by a typed range, naming it in the chip and the Filtered line", () => {
    renderGrid();

    openFilter("starts");
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-typed"), { target: { value: "Nov 1 – Nov 30" } });
    expect(screen.getByTestId("data-grid-filter-starts-chip")).toHaveTextContent("Nov 01, 2026, 12:00 AM – Nov 30, 2026, 11:59 PM");
    apply("starts");

    expect(shownRows()).toEqual(["a", "b"]);
    expect(summary()).toContain("Starts (Nov 01, 2026, 12:00 AM – Nov 30, 2026, 11:59 PM)");
  });

  it("filter by a typed span such as 1w, and say when the box reads as nothing", () => {
    renderGrid();

    openFilter("starts");
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-typed"), { target: { value: "Nov 3" } });
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-typed"), { target: { value: "soon" } });
    expect(screen.getByTestId("data-grid-filter-starts-typed-error")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-typed"), { target: { value: "1w" } });
    expect(screen.getByTestId("data-grid-filter-starts-chip")).toHaveTextContent("Past 1 week");
    apply("starts");

    expect(shownRows()).toEqual(["b"]);
  });

  it("filter by a quick entry, an N entry with its typed number, or a calendar period", () => {
    renderGrid();

    openFilter("starts");
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-amount-next-w-n"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("data-grid-filter-starts-quick-next-w-n"));
    expect(screen.getByTestId("data-grid-filter-starts-chip")).toHaveTextContent("Next 3 weeks");
    apply("starts");
    expect(shownRows()).toEqual(["d"]);

    openFilter("starts");
    fireEvent.click(screen.getByTestId("data-grid-filter-starts-period-today"));
    apply("starts");
    expect(shownRows()).toEqual(["b"]);
    expect(summary()).toContain("Starts (Today)");

    openFilter("starts");
    fireEvent.click(screen.getByTestId("data-grid-filter-starts-quick-past-h-1"));
    apply("starts");
    expect(shownRows()).toEqual([]);
  });

  it("filter by a range picked from the calendar", () => {
    renderGrid();

    openFilter("starts");
    fireEvent.click(screen.getByTestId("data-grid-filter-starts-pick"));
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-pick-from"), { target: { value: "2026-11-02T00:00" } });
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-pick-to"), { target: { value: "2026-11-02T23:59" } });
    apply("starts");

    expect(shownRows()).toEqual(["a"]);
  });

  it("clear the filter from Clear, showing every row again", () => {
    renderGrid();

    openFilter("starts");
    fireEvent.click(screen.getByTestId("data-grid-filter-starts-period-today"));
    apply("starts");
    expect(shownRows()).toEqual(["b"]);

    openFilter("starts");
    fireEvent.click(screen.getByTestId("data-grid-filter-starts-clear"));

    expect(shownRows()).toEqual(["a", "b", "c", "d"]);
  });

  it("choose no span from an N entry whose typed number is not a whole number above zero", () => {
    renderGrid();

    openFilter("starts");
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-amount-next-w-n"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("data-grid-filter-starts-quick-next-w-n"));

    expect(screen.getByTestId("data-grid-filter-starts-apply")).toBeDisabled();
  });

  it("keep the span picked so far when the calendar's end is set before its start", () => {
    renderGrid();

    openFilter("starts");
    fireEvent.click(screen.getByTestId("data-grid-filter-starts-pick"));
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-pick-from"), { target: { value: "2026-11-03T00:00" } });
    const fromOnly = screen.getByTestId("data-grid-filter-starts-chip").textContent;
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-pick-to"), { target: { value: "2026-11-02T00:00" } });

    expect(screen.getByTestId("data-grid-filter-starts-chip")).toHaveTextContent(fromOnly);
    apply("starts");
    expect(shownRows()).toEqual(["b", "d"]);
  });

  it("pick whole days on a date-only column, the end day counting to its last minute", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const columns: ColumnDef<Row, any>[] = [
      helper.accessor("name", { header: "Name", meta: { type: { kind: "text" } } }),
      helper.accessor("starts", { header: "Starts", meta: { type: { kind: "date", direction: "future" } } }),
    ];
    renderGrid(columns);

    openFilter("starts");
    expect(screen.getByTestId("data-grid-filter-starts-typed")).toHaveAttribute("placeholder", "2h, 3d, Dec 1 – Dec 31");
    fireEvent.click(screen.getByTestId("data-grid-filter-starts-pick"));
    expect(screen.getByTestId("data-grid-filter-starts-pick-from")).toHaveAttribute("type", "date");
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-pick-from"), { target: { value: "2026-11-18" } });
    fireEvent.change(screen.getByTestId("data-grid-filter-starts-pick-to"), { target: { value: "2026-11-18" } });
    apply("starts");

    expect(shownRows()).toEqual(["b"]);
  });

  it("reopen on the span already applied, and forget an unapplied choice when closed", () => {
    renderGrid();

    openFilter("starts");
    fireEvent.click(screen.getByTestId("data-grid-filter-starts-period-today"));
    apply("starts");

    openFilter("starts");
    expect(screen.getByTestId("data-grid-filter-starts-chip")).toHaveTextContent("Today");
    fireEvent.keyDown(screen.getByTestId("data-grid-filter-starts-typed"), { key: "Escape" });
    expect(screen.queryByTestId("data-grid-filter-starts-typed")).not.toBeInTheDocument();
    expect(shownRows()).toEqual(["b"]);
  });

  it("keep Apply off until a span is chosen", () => {
    renderGrid();

    openFilter("starts");

    expect(screen.getByTestId("data-grid-filter-starts-apply")).toBeDisabled();
  });
});

describe("date range columns", () => {
  it("write both ends in full with both years, an open end as …", () => {
    renderGrid();

    expect(screen.getByTestId("row-a")).toHaveTextContent("Oct 21, 2026 – Jun 18, 2027");
    expect(screen.getByTestId("row-b")).toHaveTextContent("Mar 25, 2027 – Nov 01, 2027");
    expect(screen.getByTestId("row-c")).toHaveTextContent("Sep 01, 2026 – …");
  });

  it("sort by start, then end, a blank range last", () => {
    renderGrid();

    sortBy("season");
    expect(shownRows()).toEqual(["c", "a", "b", "d"]);
    sortBy("season");
    expect(shownRows()).toEqual(["b", "a", "c", "d"]);
  });

  it.each([
    ["overlaps", "Apr 1 2027 – Apr 30 2027", ["a", "b", "c"]],
    ["overlaps", "Jun 18 2027", ["a", "b", "c"]],
    ["overlaps", "Jun 19 2027 – Jun 30 2027", ["b", "c"]],
    ["startsWithin", "Mar 25 2027", ["b"]],
    ["startsWithin", "Sep 1 2026 – Oct 21 2026", ["a", "c"]],
    ["endsWithin", "Jun 18 2027", ["a"]],
    ["endsWithin", "> Jun 18 2027", ["b"]],
  ])("match %s %s inclusively at the edges, an open end reaching as far as it needs", (match, typed, rows) => {
    renderGrid();

    openFilter("season");
    fireEvent.change(screen.getByTestId("data-grid-filter-season-match"), { target: { value: match } });
    fireEvent.change(screen.getByTestId("data-grid-filter-season-typed"), { target: { value: typed } });
    apply("season");

    expect(shownRows()).toEqual(rows);
  });
});
