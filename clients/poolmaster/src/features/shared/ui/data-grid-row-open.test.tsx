import { createColumnHelper } from "@tanstack/react-table";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DataGrid } from "./data-grid";

type Row = { id: string; name: string; size: number };

const columnHelper = createColumnHelper<Row>();
const COLUMNS = [
  columnHelper.accessor("name", {
    header: "Name",
    meta: { info: "The row's name.", type: { kind: "text" } },
  }),
  columnHelper.accessor("size", { header: "Size", meta: { type: { kind: "number" } } }),
  columnHelper.display({ id: "note", header: "Note", meta: { info: "A column that neither sorts nor filters." }, cell: () => "–" }),
];
const ROWS: Row[] = [
  { id: "a", name: "Alpha", size: 1 },
  { id: "b", name: "Beta", size: 2 },
];

describe("DataGrid column explanations", () => {
  it("shows an (i) only on columns that explain themselves, sorted or not", () => {
    render(<DataGrid columns={COLUMNS} data={ROWS} emptyMessage="None" />);

    expect(screen.getByTestId("data-grid-info-name")).toHaveAccessibleName("About Name");
    expect(screen.getByTestId("data-grid-info-note")).toHaveAccessibleName("About Note");
    expect(screen.queryByTestId("data-grid-info-size")).not.toBeInTheDocument();
  });

  it("opens the explanation from the keyboard or a click, and leaves the column's sort alone", () => {
    render(<DataGrid columns={COLUMNS} data={ROWS} emptyMessage="None" />);
    const info = screen.getByTestId("data-grid-info-name");

    info.focus();
    fireEvent.click(info);
    expect(screen.getByTestId("data-grid-info-name-callout")).toHaveTextContent("The row's name.");
    expect(screen.getByTestId("data-grid-sort-name")).not.toHaveAttribute("data-sorted");

    fireEvent.keyDown(info, { key: "Escape" });
    expect(screen.queryByTestId("data-grid-info-name-callout")).not.toBeInTheDocument();
  });

  it("keeps the column name as the one sort button a keyboard reaches beside an (i)", () => {
    render(<DataGrid columns={COLUMNS} data={ROWS} emptyMessage="None" />);
    const header = screen.getByRole("columnheader", { name: /Name/ });

    expect(within(header).getAllByRole("button").map((button) => button.getAttribute("data-testid"))).toEqual([
      "data-grid-sort-name",
      "data-grid-info-name",
      "data-grid-filter-name",
    ]);
    fireEvent.click(screen.getByTestId("data-grid-sort-name"));
    expect(screen.getByTestId("data-grid-sort-name")).toHaveAttribute("data-sorted", "asc");
  });
});

describe("DataGrid row open icons", () => {
  it("draws a › on every row that leads to a page, and the whole row still opens it", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            element={
              <DataGrid
                columns={COLUMNS}
                data={ROWS}
                emptyMessage="None"
                getRowLink={(row) => `/rows/${row.id}`}
                rowTestId={(row) => `row-${row.id}`}
              />
            }
            path="/"
          />
          <Route element={<p>Opened row b</p>} path="/rows/b" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByTestId("data-grid-row-opens-page")).toHaveLength(2);
    expect(screen.queryByTestId("data-grid-row-opens-dialog")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("row-b")).getByText("2"));
    expect(screen.getByText("Opened row b")).toBeInTheDocument();
  });

  it("draws a ⤢ button on rows that open a dialog, opening it from the row or the button", () => {
    const openRowDialog = vi.fn();
    render(
      <DataGrid
        columns={COLUMNS}
        data={ROWS}
        emptyMessage="None"
        openRowDialog={openRowDialog}
        rowTestId={(row) => `row-${row.id}`}
      />,
    );

    expect(screen.queryByTestId("data-grid-row-opens-page")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("row-a")).getByText("Alpha"));
    expect(openRowDialog).toHaveBeenLastCalledWith(ROWS[0]);
    fireEvent.click(within(screen.getByTestId("row-b")).getByRole("button", { name: "Open details" }));
    expect(openRowDialog).toHaveBeenLastCalledWith(ROWS[1]);
    expect(openRowDialog).toHaveBeenCalledTimes(2);
  });

  it("gives the icon column no sort or filter, and no icon on rows that open nothing", () => {
    render(<DataGrid columns={COLUMNS} data={ROWS} emptyMessage="None" openRowDialog={() => undefined} />);

    const openHeader = screen.getByRole("columnheader", { name: "Open" });
    expect(within(openHeader).queryByRole("button")).not.toBeInTheDocument();

    render(<DataGrid columns={COLUMNS} data={ROWS} emptyMessage="None" tableTestId="plain" />);
    expect(within(screen.getByTestId("plain")).queryByRole("columnheader", { name: "Open" })).not.toBeInTheDocument();
  });

  it("puts the › after a row's actions in the one pinned last column", () => {
    render(
      <MemoryRouter>
        <DataGrid
          columns={COLUMNS}
          data={ROWS.slice(0, 1)}
          emptyMessage="None"
          getRowLink={(row) => `/rows/${row.id}`}
          rowActions={() => <button type="button">More</button>}
        />
      </MemoryRouter>,
    );

    const endCell = screen.getByTestId("data-grid-row-actions");
    expect(within(endCell).getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(within(endCell).getByTestId("data-grid-row-opens-page")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  });
});
