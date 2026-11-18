import { createColumnHelper } from "@tanstack/react-table";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { applyTextFilter } from "@/test/data-grid-filters";
import { DataGrid } from "./data-grid";

type TestRow = {
  id: string;
  lifecycle: string;
  name: string;
};

const columnHelper = createColumnHelper<TestRow>();
const columns = [
  columnHelper.accessor("name", {
    meta: { type: { kind: "text" } },
    header: "Name",
    cell: ({ getValue }) => getValue(),
  }),
  columnHelper.accessor("lifecycle", {
    meta: { type: { kind: "text" } },
    header: "Lifecycle",
    cell: ({ getValue }) => getValue(),
  }),
];

describe("pool-master-dn4.1: shared DataGrid primitive", () => {
  it("filters rows client-side and renders the configured empty message", () => {
    render(
      <DataGrid
        columns={columns}
        data={[
          { id: "row-1", lifecycle: "Active", name: "Alpha" },
          { id: "row-2", lifecycle: "Inactive", name: "Beta" },
        ]}
        emptyMessage="No rows matched."
        getRowId={(row) => row.id}
        rowTestId={(row) => `test-row-${row.id}`}
      />,
    );

    applyTextFilter("data-grid-filter-name", "Beta");

    expect(screen.queryByTestId("test-row-row-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("test-row-row-2")).toBeInTheDocument();

    applyTextFilter("data-grid-filter-name", "Gamma");

    expect(screen.getByText("No rows matched.")).toBeInTheDocument();
  });

  it("names a column's filter after its header, and never prints a header drawn by a function as code", () => {
    const drawnHeader = [
      columnHelper.accessor("name", {
        meta: { type: { kind: "text" } },
        header: ({ table }) => `Team of ${String(table.getRowCount())}`,
        cell: ({ getValue }) => getValue(),
      }),
      columnHelper.accessor("lifecycle", {
        meta: { type: { kind: "text" } },
        header: "Lifecycle",
        cell: ({ getValue }) => getValue(),
      }),
    ];
    render(<DataGrid columns={drawnHeader} data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]} emptyMessage="No rows." getRowId={(row) => row.id} />);

    expect(screen.getByTestId("data-grid-filter-lifecycle")).toHaveAccessibleName("Filter Lifecycle");
    expect(screen.getByTestId("data-grid-filter-name")).toHaveAccessibleName("Filter name");
  });

  it("draws a leaderboard's header row navy with gold column names, and other grids' headers plain", () => {
    const rows = [{ id: "row-1", lifecycle: "Active", name: "Alpha" }];
    const { unmount } = render(
      <DataGrid columns={columns} data={rows} emptyMessage="None" headerTone="scoreboard" showColumnFilters={false} />,
    );

    expect(screen.getAllByRole("row")[0]).toHaveClass("bg-surface-inverse", "text-primary");
    unmount();

    render(<DataGrid columns={columns} data={rows} emptyMessage="None" showColumnFilters={false} />);
    expect(screen.getAllByRole("row")[0]).not.toHaveClass("bg-surface-inverse");
  });

  it("renders the first cell as a row link with optional link props", () => {
    const handleClick = vi.fn();

    render(
      <MemoryRouter>
        <DataGrid
          columns={columns}
          data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]}
          emptyMessage="No rows matched."
          getRowId={(row) => row.id}
          getRowLink={(row) => `/rows/${row.id}`}
          getRowLinkProps={() => ({
            "aria-label": "Open Alpha row",
            onClick: (event) => {
              event.preventDefault();
              handleClick();
            },
          })}
        />
      </MemoryRouter>,
    );

    const rowLink = screen.getByRole("link", { name: "Open Alpha row" });

    expect(rowLink).toHaveAttribute("href", "/rows/row-1");
    fireEvent.click(rowLink);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  describe("a linked row", () => {
    function Where() {
      return <p data-testid="where">{useLocation().pathname}</p>;
    }

    const linkedColumns = [
      ...columns,
      columnHelper.display({
        id: "action",
        header: "",
        cell: ({ row }) => <button type="button">{`Remind ${row.original.name}`}</button>,
      }),
    ];

    function renderLinkedGrid(onLinkClick: () => void = () => undefined) {
      render(
        <MemoryRouter initialEntries={["/rows"]}>
          <Routes>
            <Route
              element={(
                <DataGrid
                  columns={linkedColumns}
                  data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]}
                  emptyMessage="No rows matched."
                  getRowId={(row) => row.id}
                  getRowLink={(row) => `/rows/${row.id}`}
                  getRowLinkProps={() => ({ onClick: onLinkClick })}
                  rowTestId={(row) => `row-${row.id}`}
                />
              )}
              path="/rows"
            />
            <Route element={<Where />} path="/rows/:id" />
          </Routes>
        </MemoryRouter>,
      );
    }

    it("opens the item from a click anywhere on the row, through the row's link", () => {
      const onLinkClick = vi.fn();
      renderLinkedGrid(onLinkClick);

      fireEvent.click(screen.getByText("Active"));

      expect(screen.getByTestId("where")).toHaveTextContent("/rows/row-1");
      expect(onLinkClick).toHaveBeenCalledTimes(1);
    });

    it("opens the item in the app, without reloading the page, from its link", () => {
      renderLinkedGrid();

      fireEvent.click(screen.getByRole("link", { name: "Alpha" }));

      expect(screen.getByTestId("where")).toHaveTextContent("/rows/row-1");
    });

    it("keeps a button in the row to itself, so clicking it does not open the item", () => {
      renderLinkedGrid();

      fireEvent.click(screen.getByRole("button", { name: "Remind Alpha" }));

      expect(screen.queryByTestId("where")).not.toBeInTheDocument();
      expect(screen.getByTestId("row-row-1")).toBeInTheDocument();
    });

    it("does not open the item when the click ends selecting the row's text", () => {
      renderLinkedGrid();
      const getSelection = vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Alph" } as Selection);

      fireEvent.click(screen.getByText("Active"));

      expect(screen.queryByTestId("where")).not.toBeInTheDocument();
      getSelection.mockRestore();
    });
  });

  it("puts each row's quick actions in a last column pinned to the grid's right edge, named for screen readers", () => {
    render(
      <DataGrid
        columns={columns}
        data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]}
        emptyMessage="None"
        rowActions={(row) => <button type="button">{`Actions for ${row.name}`}</button>}
      />,
    );

    const cell = screen.getByTestId("data-grid-row-actions");
    expect(within(cell).getByRole("button", { name: "Actions for Alpha" })).toBeInTheDocument();
    expect(cell).toHaveClass("sticky", "right-0");
    expect(screen.getByRole("columnheader", { name: "Actions" })).toHaveClass("sticky", "right-0");
  });

  it("spans the empty message across the quick actions column too", () => {
    render(<DataGrid columns={columns} data={[]} emptyMessage="None" rowActions={() => null} />);

    expect(screen.getByText("None")).toHaveAttribute("colspan", "3");
  });

  it("leaves a row without a link unclickable", () => {
    render(<DataGrid columns={columns} data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]} emptyMessage="None" rowTestId={(row) => `row-${row.id}`} />);

    expect(screen.getByTestId("row-row-1")).not.toHaveClass("cursor-pointer");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  // plans/124 §6.3 — editable per-row cells read live draft state off table meta
  // so the caller can keep column defs referentially stable.
  it("exposes the caller's meta to cell renderers via table.options.meta", () => {
    const metaColumns = [
      columnHelper.display({
        id: "editor",
        header: "Editor",
        cell: ({ row, table }) => {
          const meta = table.options.meta as { label: string };
          return `${meta.label}:${row.original.name}`;
        },
      }),
    ];

    render(
      <DataGrid
        columns={metaColumns}
        data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]}
        emptyMessage="No rows matched."
        getRowId={(row) => row.id}
        meta={{ label: "draft" }}
      />,
    );

    expect(screen.getByText("draft:Alpha")).toBeInTheDocument();
  });

  it("finds rows by any text column from one search box and offers no column filters when they are off", () => {
    render(
      <DataGrid
        columns={columns}
        data={[
          { id: "row-1", lifecycle: "Active", name: "Alpha" },
          { id: "row-2", lifecycle: "Inactive", name: "Beta" },
        ]}
        emptyMessage="No rows matched."
        getRowId={(row) => row.id}
        rowTestId={(row) => `test-row-${row.id}`}
        search={{ label: "Find a row", testId: "grid-search" }}
        showColumnFilters={false}
      />,
    );

    expect(screen.queryByTestId("data-grid-filter-name")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a row" }), {
      target: { value: "inactive" },
    });

    expect(screen.queryByTestId("test-row-row-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("test-row-row-2")).toBeInTheDocument();
  });

  it("shows every row with no pager, however many there are, and a search narrows them", () => {
    const data = Array.from({ length: 60 }, (_, index) => ({
      id: `row-${index + 1}`,
      lifecycle: "Active",
      name: `Name ${index + 1}`,
    }));
    render(
      <DataGrid
        columns={columns}
        data={data}
        emptyMessage="No rows matched."
        getRowId={(row) => row.id}
        rowTestId={(row) => `test-row-${row.id}`}
        search={{ label: "Find a row" }}
      />,
    );

    expect(screen.getAllByTestId(/^test-row-/)).toHaveLength(60);
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a row" }), { target: { value: "Name 6" } });

    expect(screen.getAllByTestId(/^test-row-/).map((row) => row.getAttribute("data-testid"))).toEqual([
      "test-row-row-6",
      "test-row-row-60",
    ]);
  });

  it("narrows to a term from the page's own search box, drawing no box itself", () => {
    const data = Array.from({ length: 5 }, (_, index) => ({
      id: `row-${index + 1}`,
      lifecycle: "Active",
      name: `Name ${index + 1}`,
    }));
    const grid = (searchTerm: string) => (
      <DataGrid
        columns={columns}
        data={data}
        emptyMessage="No rows matched."
        getRowId={(row) => row.id}
        rowTestId={(row) => `test-row-${row.id}`}
        searchTerm={searchTerm}
        showColumnFilters={false}
      />
    );
    const { rerender } = render(grid(""));

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^test-row-/)).toHaveLength(5);

    rerender(grid("Name 4"));
    expect(screen.getByTestId("test-row-row-4")).toBeInTheDocument();
    expect(screen.queryByTestId("test-row-row-1")).not.toBeInTheDocument();
  });

  it("renders, filters and sorts 2,000 rows quickly enough to stay smooth", () => {
    const data = Array.from({ length: 2000 }, (_, index) => ({
      id: `row-${index + 1}`,
      lifecycle: index % 2 === 0 ? "Active" : "Inactive",
      name: `Name ${index + 1}`,
    }));
    const started = performance.now();
    render(
      <DataGrid
        columns={columns}
        data={data}
        emptyMessage="No rows matched."
        getRowId={(row) => row.id}
        search={{ label: "Find a row" }}
      />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(2001);

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a row" }), { target: { value: "Name 199" } });
    expect(screen.getAllByRole("row")).toHaveLength(1 + 11);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a row" }), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("data-grid-sort-name"));
    expect(screen.getAllByRole("row")).toHaveLength(2001);

    // A generous ceiling for a shared CI runner under jsdom; a real browser is far quicker.
    expect(performance.now() - started).toBeLessThan(15_000);
  });

  describe("jump to a row", () => {
    const data = Array.from({ length: 5 }, (_, index) => ({
      id: `row-${index + 1}`,
      lifecycle: "Active",
      name: `Name ${index + 1}`,
    }));
    const grid = (rowId: string) => (
      <DataGrid
        columns={columns}
        data={data}
        emptyMessage="No rows matched."
        getRowId={(row) => row.id}
        jumpToRow={{ rowId, label: "Jump to Name 5", testId: "test-jump" }}
        rowTestId={(row) => `test-row-${row.id}`}
        search={{ label: "Find a row", testId: "test-search" }}
      />
    );

    it("clears the search, highlights the row, and only it", async () => {
      render(grid("row-5"));
      fireEvent.change(screen.getByTestId("test-search"), { target: { value: "Name 1" } });

      fireEvent.click(screen.getByTestId("test-jump"));

      const target = await screen.findByTestId("test-row-row-5");
      expect(target).toHaveAttribute("aria-current", "true");
      expect(screen.getByTestId("test-search")).toHaveValue("");
      expect(screen.getByTestId("test-row-row-1")).not.toHaveAttribute("aria-current");
    });

    it("keeps the current sort when it jumps", async () => {
      render(grid("row-5"));
      fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
      fireEvent.click(screen.getByRole("button", { name: /^Name/ }));

      fireEvent.click(screen.getByTestId("test-jump"));

      expect(await screen.findByTestId("test-row-row-5")).toHaveAttribute("aria-current", "true");
      expect(screen.getAllByTestId(/^test-row-/)[0]).toBe(screen.getByTestId("test-row-row-5"));
    });

    it("scrolls to the row on every jump, a repeat one included, and not on a later sort", async () => {
      const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
      scroll.mockClear();
      render(grid("row-5"));

      fireEvent.click(screen.getByTestId("test-jump"));
      await screen.findByTestId("test-row-row-5");
      fireEvent.click(screen.getByTestId("test-jump"));
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));

      fireEvent.click(screen.getByRole("button", { name: /^Name/ }));

      expect(scroll).toHaveBeenCalledTimes(2);
      scroll.mockRestore();
    });

    it("scrolls the jumped row, in the table, into view", () => {
      const scrolled: Element[] = [];
      const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function scrollIntoView(this: Element) {
        scrolled.push(this);
      });
      render(grid("row-5"));

      fireEvent.click(screen.getByTestId("test-jump"));

      expect(scrolled).toHaveLength(1);
      expect(scrolled[0]).toBe(screen.getByTestId("test-row-row-5"));
      expect(scrolled[0].isConnected).toBe(true);
      scroll.mockRestore();
    });

    it("clears a column filter that hides the row before scrolling to it", () => {
      render(grid("row-5"));
      applyTextFilter("data-grid-filter-name", "Name 2");
      expect(screen.queryByTestId("test-row-row-5")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("test-jump"));

      expect(screen.getByTestId("data-grid-filter-name")).toHaveAccessibleName("Filter Name");
      expect(screen.getByTestId("test-row-row-5")).toHaveAttribute("aria-current", "true");
    });

    it("offers no jump for a row that is not in the data", () => {
      render(grid("row-9"));

      expect(screen.queryByTestId("test-jump")).not.toBeInTheDocument();
    });
  });

  describe("land on a row", () => {
    const data = Array.from({ length: 5 }, (_, index) => ({
      id: `row-${index + 1}`,
      lifecycle: "Active",
      name: `Name ${index + 1}`,
    }));
    const grid = (landOnRowId: string | null, rows: TestRow[] = data) => (
      <DataGrid
        columns={columns}
        data={rows}
        emptyMessage="No rows matched."
        getRowId={(row) => row.id}
        landOnRowId={landOnRowId}
        rowTestId={(row) => `test-row-${row.id}`}
      />
    );

    it("opens with the row highlighted and scrolled into view", () => {
      const scrolled: Element[] = [];
      const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function scrollIntoView(this: Element) {
        scrolled.push(this);
      });

      render(grid("row-3"));

      expect(screen.getByTestId("test-row-row-3")).toHaveAttribute("aria-current", "true");
      expect(scrolled).toEqual([screen.getByTestId("test-row-row-3")]);
      scroll.mockRestore();
    });

    it("lands once the row arrives, and only once: new data leaves the viewer where they are", () => {
      const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
      const { rerender } = render(grid("row-5", []));
      expect(scroll).not.toHaveBeenCalled();

      rerender(grid("row-5"));
      expect(screen.getByTestId("test-row-row-5")).toHaveAttribute("aria-current", "true");
      rerender(grid("row-5", [...data]));

      expect(scroll).toHaveBeenCalledTimes(1);
      scroll.mockRestore();
    });

    it("ignores a row it doesn't hold, with nothing highlighted or scrolled", () => {
      const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);

      render(grid("row-9"));

      expect(screen.getByTestId("test-row-row-1")).not.toHaveAttribute("aria-current");
      expect(scroll).not.toHaveBeenCalled();
      scroll.mockRestore();
    });
  });

  it("puts the views and the search in one header inside the grid's card, above the table", () => {
    const onChange = vi.fn();
    render(
      <DataGrid
        columns={columns}
        data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]}
        emptyMessage="No rows matched."
        search={{ label: "Find a row", testId: "grid-search" }}
        showColumnFilters={false}
        tableTestId="grid-table"
        views={{
          label: "Rows to show",
          onChange,
          options: [
            { count: 1, label: "Active", value: "active" },
            { label: "History", value: "history" },
          ],
          value: "active",
        }}
      />,
    );

    // The views come first, then the search, then the table, all in the one card.
    const views = screen.getByRole("radiogroup", { name: "Rows to show" });
    const search = screen.getByTestId("grid-search");
    const grid = screen.getByTestId("grid-table");
    expect(views.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(search.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Active 1" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "History" }));
    expect(onChange).toHaveBeenCalledWith("history");
  });

  it("draws the caller's toolbar control after the search, with or without views", () => {
    const grid = (views?: { label: string; onChange: () => void; options: { label: string; value: string }[]; value: string }) => (
      <DataGrid
        columns={columns}
        data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]}
        emptyMessage="No rows matched."
        search={{ label: "Find a row", testId: "grid-search" }}
        showColumnFilters={false}
        toolbarEnd={<button data-testid="grid-toolbar-end" type="button">Mine</button>}
        views={views}
      />
    );
    const { rerender } = render(grid());

    expect(screen.getByTestId("grid-search").compareDocumentPosition(screen.getByTestId("grid-toolbar-end")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(grid({ label: "Rows to show", onChange: vi.fn(), options: [{ label: "Active", value: "active" }], value: "active" }));

    expect(screen.getByTestId("grid-search").compareDocumentPosition(screen.getByTestId("grid-toolbar-end")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws a view's loading or error state in the card in place of the table, keeping the views", () => {
    render(
      <DataGrid
        columns={columns}
        data={[
          { id: "row-1", lifecycle: "Active", name: "Alpha" },
          { id: "row-2", lifecycle: "Active", name: "Beta" },
        ]}
        emptyMessage="No rows matched."
        tableTestId="grid-table"
        views={{
          label: "Rows to show",
          onChange: () => undefined,
          options: [{ label: "History", value: "history" }],
          status: <p data-testid="grid-status">Loading history...</p>,
          value: "history",
        }}
      />,
    );

    expect(screen.getByTestId("grid-status")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "History" })).toBeChecked();
    expect(screen.queryByTestId("grid-table")).not.toBeInTheDocument();
  });

  it("keeps what was typed in the search when the view changes", () => {
    const rows = (prefix: string) => Array.from({ length: 5 }, (_, index) => ({ id: `${prefix}-${index + 1}`, lifecycle: "Active", name: `${prefix} ${index + 1}` }));
    function Grid({ view }: { view: string }) {
      return (
        <DataGrid
          columns={columns}
          data={rows(view)}
          emptyMessage="No rows matched."
          getRowId={(row) => row.id}
          search={{ label: "Find a row" }}
          views={{
            label: "Rows to show",
            onChange: () => undefined,
            options: [{ label: "Current", value: "Current" }, { label: "History", value: "History" }],
            value: view,
          }}
        />
      );
    }
    const { rerender } = render(<Grid view="Current" />);
    // Every row's lifecycle reads "Active", so the term keeps all five in either view.
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a row" }), { target: { value: "Active" } });

    rerender(<Grid view="History" />);

    expect(screen.getByRole("searchbox", { name: "Find a row" })).toHaveValue("Active");
    expect(screen.getAllByRole("row")).toHaveLength(6);
  });

  it("draws a filter for the chosen view just after the views, before the search", () => {
    render(
      <DataGrid
        columns={columns}
        data={[{ id: "row-1", lifecycle: "Final", name: "Alpha" }]}
        emptyMessage="No rows matched."
        search={{ label: "Find a row", testId: "grid-search" }}
        showColumnFilters={false}
        tableTestId="grid-table"
        views={{
          end: <label>Season <select aria-label="Season"><option>2099</option></select></label>,
          label: "Rows to show",
          onChange: () => undefined,
          options: [{ label: "Active", value: "active" }, { label: "History", value: "history" }],
          value: "history",
        }}
      />,
    );

    const history = screen.getByRole("radio", { name: "History" });
    const season = screen.getByRole("combobox", { name: "Season" });
    expect(history.compareDocumentPosition(season) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(season.compareDocumentPosition(screen.getByTestId("grid-search")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("grid-table-views-end")).toContainElement(season);
  });
  it("keeps a column marked pinned at the start stuck to the grid's left edge, header and cells, and leaves the others to scroll", () => {
    const pinnedColumns = [
      columnHelper.accessor("name", { header: "Name", cell: ({ getValue }) => getValue(), meta: { type: { kind: "text" }, pinned: "start" } }),
      columnHelper.accessor("lifecycle", { meta: { type: { kind: "text" } }, header: "Lifecycle", cell: ({ getValue }) => getValue() }),
    ];
    render(
      <DataGrid
        columns={pinnedColumns}
        data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]}
        emptyMessage="No rows."
        getRowId={(row) => row.id}
      />,
    );

    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveClass("sticky", "left-0");
    expect(screen.getByRole("cell", { name: "Alpha" })).toHaveClass("sticky", "left-0", "bg-card");
    expect(screen.getByRole("columnheader", { name: /Lifecycle/ })).not.toHaveClass("sticky");
    expect(screen.getByRole("cell", { name: "Active" })).not.toHaveClass("sticky");
  });

  it("draws a row's detail rows under it, each cell under the column it is keyed to and the pinned column still pinned", () => {
    const pinnedColumns = [
      columnHelper.accessor("name", { header: "Name", cell: ({ getValue }) => getValue(), meta: { type: { kind: "text" }, pinned: "start" } }),
      columnHelper.accessor("lifecycle", { meta: { type: { kind: "text" } }, header: "Lifecycle", cell: ({ getValue }) => getValue() }),
    ];
    render(
      <DataGrid
        columns={pinnedColumns}
        data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }, { id: "row-2", lifecycle: "Inactive", name: "Beta" }]}
        detailRows={(row) => (row.id === "row-1" ? [{ id: "d1", testId: "detail-1", cells: { name: "First game", lifecycle: "Won" } }] : [])}
        emptyMessage="No rows."
        getRowId={(row) => row.id}
        rowTestId={(row) => `row-${row.id}`}
      />,
    );

    const detail = screen.getByTestId("detail-1");
    expect(within(detail).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["First game", "Won"]);
    expect(within(detail).getByRole("cell", { name: "First game" })).toHaveClass("sticky", "left-0");
    // Under its own row, before the next one.
    expect(screen.getAllByRole("row").map((row) => row.getAttribute("data-testid")).filter(Boolean)).toEqual(["row-row-1", "detail-1", "row-row-2"]);
  });

  it("spans a detail row's line across every column from the one it names to the end", () => {
    const threeColumns = [
      ...columns,
      columnHelper.accessor("id", { meta: { type: { kind: "text" } }, header: "Id", cell: ({ getValue }) => getValue() }),
    ];
    render(
      <DataGrid
        columns={threeColumns}
        data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]}
        detailRows={() => [{ id: "d1", testId: "detail-1", cells: { name: "Week 3" }, span: { fromColumnId: "lifecycle", content: "KC v BUF · Won" } }]}
        emptyMessage="No rows."
        getRowId={(row) => row.id}
        rowActions={() => <button type="button">More</button>}
      />,
    );

    const cells = within(screen.getByTestId("detail-1")).getAllByRole("cell");
    expect(cells.map((cell) => [cell.textContent, cell.getAttribute("colspan")])).toEqual([["Week 3", "1"], ["KC v BUF · Won", "2"], ["", null]]);
  });
});
