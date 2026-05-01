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
});
