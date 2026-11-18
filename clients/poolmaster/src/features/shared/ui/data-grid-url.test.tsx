import { createColumnHelper } from "@tanstack/react-table";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";
import { applyTextFilter } from "@/test/data-grid-filters";
import { DataGrid } from "./data-grid";

type Row = { id: string; name: string; size: number };

const columnHelper = createColumnHelper<Row>();
const COLUMNS = [
  columnHelper.accessor("name", { header: "Name", meta: { type: { kind: "text" } } }),
  columnHelper.accessor("size", { header: "Size", meta: { type: { kind: "number" } } }),
];
const ROWS: Row[] = [
  { id: "a", name: "Alpha", size: 30 },
  { id: "b", name: "Beta", size: 10 },
  { id: "c", name: "Gamma", size: 20 },
];

function Address() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="address">{location.search}</p>
      <button data-testid="back" onClick={() => void navigate(-1)} type="button">Back</button>
    </>
  );
}
const goBack = () => fireEvent.click(screen.getByTestId("back"));

function renderAt(search: string, grids: { key?: string; testId: string }[] = [{ testId: "grid" }]) {
  return render(
    <MemoryRouter initialEntries={[`/list${search}`]}>
      {grids.map((grid) => (
        <DataGrid
          columns={COLUMNS}
          data={ROWS}
          emptyMessage="None"
          filterTestIdPrefix={`${grid.testId}-filter`}
          getRowId={(row) => row.id}
          key={grid.testId}
          rowTestId={(row) => `${grid.testId}-row-${row.id}`}
          tableTestId={grid.testId}
          urlKey={grid.key}
        />
      ))}
      <Address />
    </MemoryRouter>,
  );
}

const names = (testId = "grid") =>
  within(screen.getByTestId(testId)).getAllByRole("row").slice(1).map((row) => row.getAttribute("data-testid")?.split("-").at(-1));
const linkParam = (key = "grid") => new URLSearchParams(screen.getByTestId("address").textContent).get(key);

describe("DataGrid filters and sort in the page link", () => {
  it("opens a link with its filters and sort applied", () => {
    const link = JSON.stringify({ s: "-size", f: { name: { kind: "text", term: "a", match: "contains" } } });
    renderAt(`?grid=${encodeURIComponent(link)}`);

    expect(names()).toEqual(["a", "c", "b"]);
    expect(screen.getByTestId("data-grid-sort-size")).toHaveAttribute("data-sorted", "desc");
    expect(screen.getByTestId("grid-filter-name")).toHaveAccessibleName(/Filter Name, filtered/);
  });

  it("writes an applied filter and a sort into the link, keeping the page's other parameters", () => {
    renderAt("?mine=1");

    applyTextFilter("grid-filter-name", "Gam");
    expect(names()).toEqual(["c"]);
    expect(JSON.parse(linkParam() ?? "null")).toEqual({ f: { name: { kind: "text", term: "Gam", match: "contains" } } });

    fireEvent.click(screen.getByTestId("data-grid-sort-name"));
    expect(JSON.parse(linkParam() ?? "null")).toMatchObject({ s: "name" });
    expect(linkParam("mine")).toBe("1");
  });

  it("steps Back through filter changes, and drops the parameter once nothing is kept", () => {
    renderAt("");

    fireEvent.click(screen.getByTestId("data-grid-sort-size"));
    expect(names()).toEqual(["b", "c", "a"]);
    applyTextFilter("grid-filter-name", "Gam");
    expect(names()).toEqual(["c"]);

    goBack();
    expect(names()).toEqual(["b", "c", "a"]);

    goBack();
    expect(names()).toEqual(["a", "b", "c"]);
    expect(linkParam()).toBeNull();
  });

  it("ignores a link it can't read, showing the grid as it starts", () => {
    renderAt("?grid=%7Bnot-json");

    expect(names()).toEqual(["a", "b", "c"]);
    expect(screen.getByTestId("data-grid-sort-name")).not.toHaveAttribute("data-sorted");
  });

  it("takes no filters from the link for a grid that shows none, keeping its sort", () => {
    const link = JSON.stringify({ s: "size", f: { name: { kind: "text", term: "Beta", match: "contains" } } });
    render(
      <MemoryRouter initialEntries={[`/list?grid=${encodeURIComponent(link)}`]}>
        <DataGrid
          columns={COLUMNS}
          data={ROWS}
          emptyMessage="None"
          getRowId={(row) => row.id}
          rowTestId={(row) => `grid-row-${row.id}`}
          showColumnFilters={false}
          tableTestId="grid"
        />
      </MemoryRouter>,
    );

    expect(names()).toEqual(["b", "c", "a"]);
  });

  it("keeps two grids on one page apart by their keys", () => {
    renderAt("", [
      { key: "left", testId: "left" },
      { key: "right", testId: "right" },
    ]);

    applyTextFilter("left-filter-name", "Beta");

    expect(names("left")).toEqual(["b"]);
    expect(names("right")).toEqual(["a", "b", "c"]);
    expect(linkParam("left")).not.toBeNull();
    expect(linkParam("right")).toBeNull();
  });
});
