import { createColumnHelper } from "@tanstack/react-table";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("renders the first cell as a row link with optional link props", () => {
    const handleClick = vi.fn();

    render(
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
      />,
    );

    const rowLink = screen.getByRole("link", { name: "Open Alpha row" });

    expect(rowLink).toHaveAttribute("href", "/rows/row-1");
    fireEvent.click(rowLink);
    expect(handleClick).toHaveBeenCalledTimes(1);
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
});
