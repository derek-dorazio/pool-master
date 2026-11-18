import { createColumnHelper } from "@tanstack/react-table";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DataGrid } from "./data-grid";
import { optionsFromLabels } from "./data-grid-filters";

type Run = { id: string; name: string; status: string; issues: string[]; field?: number };

const RUNS: Run[] = [
  { id: "a", name: "Alpha", status: "DRAFT", issues: [], field: 72 },
  { id: "b", name: "Bravo", status: "COMPLETED", issues: ["SYNC"], field: 70 },
  { id: "c", name: "Charlie", status: "COMPLETED WITH WARNINGS", issues: ["SYNC", "RELEASE"] },
  { id: "d", name: "Delta", status: "SCHEDULED", issues: ["LINKING"], field: 132 },
];

const STATUS_LABELS = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  "COMPLETED WITH WARNINGS": "Completed with warnings",
};
const ISSUE_LABELS = { SYNC: "Sync", RELEASE: "Release", LINKING: "Linking", OVERDUE: "Overdue" };

const columnHelper = createColumnHelper<Run>();

function buildColumns(statusInitial?: readonly string[]) {
  return [
    columnHelper.accessor("name", { header: "Name" }),
    columnHelper.accessor("status", {
      header: "Status",
      meta: { options: { values: optionsFromLabels(STATUS_LABELS), initial: statusInitial } },
      cell: ({ getValue }) => STATUS_LABELS[getValue() as keyof typeof STATUS_LABELS],
    }),
    columnHelper.accessor("issues", {
      header: "Issues",
      meta: { options: { values: optionsFromLabels(ISSUE_LABELS), manyPerCell: true } },
      cell: ({ getValue }) => getValue().join(", "),
      enableSorting: false,
    }),
    columnHelper.accessor("field", { header: "Field" }),
  ];
}

function renderGrid(statusInitial?: readonly string[]) {
  const user = userEvent.setup();
  render(
    <DataGrid
      columns={buildColumns(statusInitial)}
      data={RUNS}
      emptyMessage="No runs match."
      getRowId={(run) => run.id}
      rowTestId={(run) => `row-${run.id}`}
    />,
  );
  return { user };
}

/** Each checkbox, in order, is named by its value's words. */
function expectNames(boxes: HTMLElement[], names: string[]) {
  expect(boxes).toHaveLength(names.length);
  boxes.forEach((box, index) => expect(box).toHaveAccessibleName(names[index]));
}

function shownRows() {
  return screen.queryAllByTestId(/^row-/).map((row) => row.getAttribute("data-testid")?.slice(4));
}

describe("DataGrid header sorting", () => {
  it("sorts by a column ascending, then descending, then back to the data's order, one arrow marking the sort", async () => {
    const { user } = renderGrid();
    const sort = screen.getByTestId("data-grid-sort-name");

    await user.click(sort);
    expect(shownRows()).toEqual(["a", "b", "c", "d"]);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
    await user.click(sort);
    expect(shownRows()).toEqual(["d", "c", "b", "a"]);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "descending");
    await user.click(sort);
    expect(shownRows()).toEqual(["a", "b", "c", "d"]);
    expect(screen.getByRole("columnheader", { name: /Name/ })).not.toHaveAttribute("aria-sort");
  });

  it("sorts one column at a time: sorting another drops the first", async () => {
    const { user } = renderGrid();

    await user.click(screen.getByTestId("data-grid-sort-name"));
    await user.click(screen.getByTestId("data-grid-sort-field"));

    expect(screen.getByRole("columnheader", { name: /Name/ })).not.toHaveAttribute("aria-sort");
    expect(screen.getByRole("columnheader", { name: /Field/ })).toHaveAttribute("aria-sort", "ascending");
  });

  it("puts blank values last whichever way the column sorts", async () => {
    const { user } = renderGrid();
    const sort = screen.getByTestId("data-grid-sort-field");

    await user.click(sort);
    expect(shownRows()).toEqual(["b", "a", "d", "c"]);
    await user.click(sort);
    expect(shownRows()).toEqual(["d", "a", "b", "c"]);
  });

  it("sorts an enumerated column in its declared order, not A to Z", async () => {
    const { user } = renderGrid();

    await user.click(screen.getByTestId("data-grid-sort-status"));

    expect(shownRows()).toEqual(["a", "d", "b", "c"]);
  });

  it("sorts only the rows the filters leave", async () => {
    const { user } = renderGrid(["COMPLETED", "SCHEDULED"]);

    await user.click(screen.getByTestId("data-grid-sort-name"));
    await user.click(screen.getByTestId("data-grid-sort-name"));

    expect(shownRows()).toEqual(["d", "b"]);
  });
});

describe("DataGrid filter popup", () => {
  it("opens from the column's funnel as a popup outside the table, so no row moves", async () => {
    const { user } = renderGrid();

    await user.click(screen.getByTestId("data-grid-filter-name"));

    const popup = screen.getByTestId("data-grid-filter-name-popup");
    expect(screen.getByRole("table")).not.toContainElement(popup);
    expect(within(popup).getByText("Filter: Name")).toBeInTheDocument();
  });

  it("Apply sets the filter and closes, handing focus back to the funnel", async () => {
    const { user } = renderGrid();
    const funnel = screen.getByTestId("data-grid-filter-name");

    await user.click(funnel);
    await user.type(screen.getByTestId("data-grid-filter-name-term"), "rav");
    await user.click(screen.getByTestId("data-grid-filter-name-apply"));

    expect(shownRows()).toEqual(["b"]);
    expect(screen.queryByTestId("data-grid-filter-name-popup")).not.toBeInTheDocument();
    expect(funnel).toHaveFocus();
    expect(funnel).toHaveAccessibleName("Filter Name, filtered");
  });

  it("Enter applies what was typed", async () => {
    const { user } = renderGrid();

    await user.click(screen.getByTestId("data-grid-filter-name"));
    await user.type(screen.getByTestId("data-grid-filter-name-term"), "elt{Enter}");

    expect(shownRows()).toEqual(["d"]);
    expect(screen.queryByTestId("data-grid-filter-name-popup")).not.toBeInTheDocument();
  });

  it("Cancel and Escape close without changing the filter, handing focus back to the funnel", async () => {
    const { user } = renderGrid();
    const funnel = screen.getByTestId("data-grid-filter-name");

    await user.click(funnel);
    await user.type(screen.getByTestId("data-grid-filter-name-term"), "rav");
    await user.click(screen.getByTestId("data-grid-filter-name-cancel"));
    expect(shownRows()).toEqual(["a", "b", "c", "d"]);
    expect(funnel).toHaveFocus();

    await user.click(funnel);
    expect(screen.getByTestId("data-grid-filter-name-term")).toHaveValue("");
    await user.type(screen.getByTestId("data-grid-filter-name-term"), "rav{Escape}");
    expect(screen.queryByTestId("data-grid-filter-name-popup")).not.toBeInTheDocument();
    expect(shownRows()).toEqual(["a", "b", "c", "d"]);
    expect(funnel).toHaveFocus();
  });

  it("Clear removes the column's filter", async () => {
    const { user } = renderGrid();
    await user.click(screen.getByTestId("data-grid-filter-name"));
    await user.type(screen.getByTestId("data-grid-filter-name-term"), "rav{Enter}");

    await user.click(screen.getByTestId("data-grid-filter-name"));
    await user.click(screen.getByTestId("data-grid-filter-name-clear"));

    expect(shownRows()).toEqual(["a", "b", "c", "d"]);
    expect(screen.getByTestId("data-grid-filter-name")).toHaveAccessibleName("Filter Name");
  });

  it("offers no funnel when the grid turns column filters off", () => {
    render(<DataGrid columns={buildColumns()} data={RUNS} emptyMessage="None" showColumnFilters={false} />);

    expect(screen.queryByTestId("data-grid-filter-name")).not.toBeInTheDocument();
    expect(screen.getByTestId("data-grid-sort-name")).toBeInTheDocument();
  });
});

describe("DataGrid enum filter", () => {
  it("lists a checkbox per value in the declared order, every one ticked while no filter is set", async () => {
    const { user } = renderGrid();

    await user.click(screen.getByTestId("data-grid-filter-status"));

    const popup = screen.getByTestId("data-grid-filter-status-popup");
    const boxes = within(popup).getAllByRole("checkbox").slice(1);
    expectNames(boxes, ["Draft", "Scheduled", "Completed", "Completed with warnings"]);
    boxes.forEach((box) => expect(box).toBeChecked());
  });

  it("lists the values found in the rows A to Z when the column declares none", async () => {
    const user = userEvent.setup();
    const found = [columnHelper.accessor("name", { header: "Name", meta: { options: {} } })];
    render(<DataGrid columns={found} data={[...RUNS].reverse()} emptyMessage="None" />);

    await user.click(screen.getByTestId("data-grid-filter-name"));

    const boxes = within(screen.getByTestId("data-grid-filter-name-popup")).getAllByRole("checkbox").slice(1);
    expect(boxes).toHaveLength(4);
    expectNames(boxes, ["Alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("matches a value exactly, so Completed never shows Completed with warnings", async () => {
    const { user } = renderGrid();
    await user.click(screen.getByTestId("data-grid-filter-status"));
    await user.click(screen.getByTestId("data-grid-filter-status-all"));

    await user.click(screen.getByTestId("data-grid-filter-status-option-COMPLETED"));
    await user.click(screen.getByTestId("data-grid-filter-status-apply"));

    expect(shownRows()).toEqual(["b"]);
  });

  it("Select all unticks and ticks every value, and reads part-ticked in between", async () => {
    const { user } = renderGrid();
    await user.click(screen.getByTestId("data-grid-filter-status"));
    const selectAll = screen.getByTestId("data-grid-filter-status-all");

    await user.click(selectAll);
    expect(screen.getByTestId("data-grid-filter-status-option-DRAFT")).not.toBeChecked();
    await user.click(screen.getByTestId("data-grid-filter-status-option-DRAFT"));
    expect(selectAll).toBePartiallyChecked();
    await user.click(selectAll);
    expect(screen.getByTestId("data-grid-filter-status-option-SCHEDULED")).toBeChecked();
  });

  it("can't be applied with nothing ticked; Clear is the way to remove it", async () => {
    const { user } = renderGrid(["DRAFT"]);
    await user.click(screen.getByTestId("data-grid-filter-status"));

    await user.click(screen.getByTestId("data-grid-filter-status-option-DRAFT"));
    expect(screen.getByTestId("data-grid-filter-status-apply")).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("data-grid-filter-status-popup")).toBeInTheDocument();

    await user.click(screen.getByTestId("data-grid-filter-status-clear"));
    expect(shownRows()).toEqual(["a", "b", "c", "d"]);
  });

  it("opens on a column's starting values", () => {
    renderGrid(["DRAFT", "SCHEDULED"]);

    expect(shownRows()).toEqual(["a", "d"]);
    expect(screen.getByTestId("data-grid-filter-status")).toHaveAccessibleName("Filter Status, filtered");
  });

  it("names each filter in force above the grid with how many rows show, and Clear all filters clears them", async () => {
    const { user } = renderGrid(["DRAFT", "SCHEDULED"]);

    expect(screen.getByTestId("data-grid-filter-summary")).toHaveTextContent("Filtered: Status (2 of 4)");
    expect(screen.getByTestId("data-grid-filter-summary-count")).toHaveTextContent("2 of 4");

    await user.click(screen.getByTestId("data-grid-filter-summary-clear-all"));
    expect(shownRows()).toEqual(["a", "b", "c", "d"]);
    expect(screen.queryByTestId("data-grid-filter-summary")).not.toBeInTheDocument();
  });

  it("shows a row holding several values while any ticked value is in it, or only when every one is with Match all", async () => {
    const { user } = renderGrid();
    await user.click(screen.getByTestId("data-grid-filter-issues"));
    await user.click(screen.getByTestId("data-grid-filter-issues-all"));
    await user.click(screen.getByTestId("data-grid-filter-issues-option-SYNC"));
    await user.click(screen.getByTestId("data-grid-filter-issues-option-RELEASE"));
    await user.click(screen.getByTestId("data-grid-filter-issues-apply"));
    expect(shownRows()).toEqual(["b", "c"]);

    await user.click(screen.getByTestId("data-grid-filter-issues"));
    await user.selectOptions(screen.getByTestId("data-grid-filter-issues-match"), "all");
    await user.click(screen.getByTestId("data-grid-filter-issues-apply"));
    expect(shownRows()).toEqual(["c"]);
    expect(screen.getByTestId("data-grid-filter-summary")).toHaveTextContent("Issues (all 2 of 5)");
  });

  it("offers (None) on a several-per-cell column, finding the rows that hold no value", async () => {
    const { user } = renderGrid();
    await user.click(screen.getByTestId("data-grid-filter-issues"));
    await user.click(screen.getByTestId("data-grid-filter-issues-all"));

    await user.click(screen.getByRole("checkbox", { name: "(None)" }));
    await user.click(screen.getByTestId("data-grid-filter-issues-apply"));

    expect(shownRows()).toEqual(["a"]);
  });

  it("searches a long list of values, and Select all ticks only the ones the search shows", async () => {
    const user = userEvent.setup();
    const sports = ["Baseball", "Basketball", "Cricket", "Cycling", "Football", "Golf", "Hockey", "Racing", "Soccer", "Tennis"];
    const rows = sports.map((sport, index) => ({ id: String(index), name: sport, status: "DRAFT", issues: [] }));
    const columns = [columnHelper.accessor("name", { header: "Sport", meta: { options: {} } })];
    render(<DataGrid columns={columns} data={rows} emptyMessage="None" rowTestId={(row) => `row-${row.id}`} />);

    await user.click(screen.getByTestId("data-grid-filter-name"));
    await user.click(screen.getByTestId("data-grid-filter-name-all"));
    await user.type(screen.getByTestId("data-grid-filter-name-search"), "ba");
    expect(within(screen.getByTestId("data-grid-filter-name-popup")).getAllByRole("checkbox")).toHaveLength(4);
    await user.click(screen.getByTestId("data-grid-filter-name-all"));
    await user.click(screen.getByTestId("data-grid-filter-name-apply"));

    expect(shownRows()).toEqual(["0", "1", "4"]);
  });
});
