import { createColumnHelper } from "@tanstack/react-table";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DataGrid } from "./data-grid";

type TestRow = {
  id: string;
  lifecycle: string;
  name: string;
};

const columnHelper = createColumnHelper<TestRow>();
const columns = [
  columnHelper.accessor("name", {
    header: "Name",
    cell: ({ getValue }) => getValue(),
  }),
  columnHelper.accessor("lifecycle", {
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

    fireEvent.change(screen.getByTestId("data-grid-filter-name"), {
      target: {
        value: "Beta",
      },
    });

    expect(screen.queryByTestId("test-row-row-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("test-row-row-2")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("data-grid-filter-name"), {
      target: {
        value: "Gamma",
      },
    });

    expect(screen.getByText("No rows matched.")).toBeInTheDocument();
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

  it("pages rows, and a new search starts again from the first page", async () => {
    const data = Array.from({ length: 5 }, (_, index) => ({
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
        pageSize={2}
        rowTestId={(row) => `test-row-${row.id}`}
        search={{ label: "Find a row" }}
      />,
    );

    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(pages).toHaveTextContent("1–2 of 5");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(pages).toHaveTextContent("5–5 of 5");
    expect(screen.getByTestId("test-row-row-5")).toBeInTheDocument();
    expect(screen.queryByTestId("test-row-row-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a row" }), {
      target: { value: "Name" },
    });

    expect(await screen.findByTestId("test-row-row-1")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Pages" })).toHaveTextContent("1–2 of 5");
  });

  it("narrows to a term from the page's own search box, drawing no box itself, and starts again from the first page", async () => {
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
        pageSize={2}
        rowTestId={(row) => `test-row-${row.id}`}
        searchTerm={searchTerm}
        showColumnFilters={false}
      />
    );
    const { rerender } = render(grid(""));

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("navigation", { name: "Pages" })).toHaveTextContent("3–4 of 5");

    rerender(grid("Name"));
    expect(await screen.findByTestId("test-row-row-1")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Pages" })).toHaveTextContent("1–2 of 5");

    rerender(grid("Name 4"));
    expect(screen.getByTestId("test-row-row-4")).toBeInTheDocument();
    expect(screen.queryByTestId("test-row-row-1")).not.toBeInTheDocument();
  });

  it("shows no pager when every row fits on one page", () => {
    render(
      <DataGrid
        columns={columns}
        data={[{ id: "row-1", lifecycle: "Active", name: "Alpha" }]}
        emptyMessage="No rows matched."
        pageSize={2}
      />,
    );

    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
  });

  it("moves back to the last page left when the caller passes fewer rows", async () => {
    const data = Array.from({ length: 5 }, (_, index) => ({
      id: `row-${index + 1}`,
      lifecycle: "Active",
      name: `Name ${index + 1}`,
    }));
    const grid = (rows: TestRow[]) => (
      <DataGrid
        columns={columns}
        data={rows}
        emptyMessage="No rows matched."
        getRowId={(row) => row.id}
        pageSize={2}
        rowTestId={(row) => `test-row-${row.id}`}
      />
    );
    const { rerender } = render(grid(data));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    rerender(grid(data.slice(0, 3)));

    expect(await screen.findByTestId("test-row-row-3")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Pages" })).toHaveTextContent("3–3 of 3");
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
        pageSize={2}
        rowTestId={(row) => `test-row-${row.id}`}
        search={{ label: "Find a row", testId: "test-search" }}
      />
    );

    it("clears the search, turns to the row's page and highlights it, and only it", async () => {
      render(grid("row-5"));
      fireEvent.change(screen.getByTestId("test-search"), { target: { value: "Name 1" } });

      fireEvent.click(screen.getByTestId("test-jump"));

      const target = await screen.findByTestId("test-row-row-5");
      expect(target).toHaveAttribute("aria-current", "true");
      expect(screen.getByTestId("test-search")).toHaveValue("");
      expect(screen.getByRole("navigation", { name: "Pages" })).toHaveTextContent("5–5 of 5");
      expect(screen.queryByTestId("test-row-row-1")).not.toBeInTheDocument();
    });

    it("finds the row's page in the current sort", async () => {
      render(grid("row-5"));
      // Sorted by name descending, Name 5 leads the first page.
      fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
      fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      fireEvent.click(screen.getByTestId("test-jump"));

      expect(await screen.findByTestId("test-row-row-5")).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("navigation", { name: "Pages" })).toHaveTextContent("1–2 of 5");
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

    it("scrolls the jumped row, on its page in the table, into view", () => {
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

    it("clears a column filter that hides the row before turning to its page", () => {
      render(grid("row-5"));
      fireEvent.change(screen.getByTestId("data-grid-filter-name"), { target: { value: "Name 2" } });
      expect(screen.queryByTestId("test-row-row-5")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("test-jump"));

      expect(screen.getByTestId("data-grid-filter-name")).toHaveValue("");
      expect(screen.getByTestId("test-row-row-5")).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("navigation", { name: "Pages" })).toHaveTextContent("5–5 of 5");
    });

    it("offers no jump for a row that is not in the data", () => {
      render(grid("row-9"));

      expect(screen.queryByTestId("test-jump")).not.toBeInTheDocument();
    });
  });
});
