import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState, type AnchorHTMLAttributes } from "react";
import { Button } from "./button";
import { cn } from "./class-names";
import { Input } from "./form-field";

/** One search box across the grid's text columns (rules/ux-rules.md §12 rule 7). */
export type DataGridSearch = {
  /** Accessible name of the search box, e.g. "Find a team". */
  label: string;
  placeholder?: string;
  testId?: string;
};

type DataGridProps<TData> = {
  // TanStack's ColumnDef<TData, TValue> is invariant in TValue, so a heterogeneous column
  // array cannot name a single TValue -- `unknown` rejects ColumnDef<Row, string>. `any` is
  // TanStack's own documented shape for this position.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  data: TData[];
  emptyMessage: string;
  filterTestIdPrefix?: string;
  getRowId?: (row: TData, index: number) => string;
  getRowLink?: (row: TData) => string;
  getRowLinkProps?: (
    row: TData,
  ) => Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;
  rowTestId?: (row: TData, index: number) => string;
  tableTestId?: string;
  /**
   * Forwarded to `useReactTable({ meta })`. Lets a caller keep its column
   * definitions referentially stable while editable cells read live draft state
   * off `table.options.meta` (per-row draft editors — plans/124 §6.3 golf
   * roster / field).
   */
  meta?: Record<string, unknown>;
  /** A search box above the grid matching any text column. Off by default. */
  search?: DataGridSearch;
  /** Rows per page; omitted, every row shows on one page. */
  pageSize?: number;
  /** Whether each filterable column gets its own filter box. On by default. */
  showColumnFilters?: boolean;
};

function getSortIndicator(direction: false | "asc" | "desc") {
  if (direction === "asc") {
    return "▲";
  }

  if (direction === "desc") {
    return "▼";
  }

  return "↕";
}

export function DataGrid<TData>({
  columns,
  data,
  emptyMessage,
  filterTestIdPrefix = "data-grid-filter",
  getRowId,
  getRowLink,
  getRowLinkProps,
  rowTestId,
  tableTestId,
  meta,
  search,
  pageSize,
  showColumnFilters = true,
}: DataGridProps<TData>) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSize ?? Number.MAX_SAFE_INTEGER,
  });

  const resetPageIndex = () =>
    setPagination((current) => ({ ...current, pageIndex: 0 }));

  const table = useReactTable({
    data,
    columns,
    meta,
    state: {
      columnFilters,
      globalFilter,
      pagination,
      sorting,
    },
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // A new search, filter or sort starts again from the first page.
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater);
      resetPageIndex();
    },
    onGlobalFilterChange: (updater: string) => {
      setGlobalFilter(updater);
      resetPageIndex();
    },
    onPaginationChange: setPagination,
    onSortingChange: (updater) => {
      setSorting(updater);
      resetPageIndex();
    },
    getRowId,
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const visibleColumnCount = useMemo(
    () => table.getVisibleLeafColumns().length,
    [table],
  );

  const matchingRowCount = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  if (pagination.pageIndex > 0 && pagination.pageIndex >= pageCount) {
    // The caller passed fewer rows than before (a refetch, or a narrower filter of its own):
    // show the last page there still is rather than an empty one.
    setPagination({ ...pagination, pageIndex: Math.max(pageCount - 1, 0) });
  }
  const firstShown = matchingRowCount ? pagination.pageIndex * pagination.pageSize + 1 : 0;
  const lastShown = Math.min(matchingRowCount, (pagination.pageIndex + 1) * pagination.pageSize);

  return (
    <div className="grid gap-3">
      {search ? (
        <Input
          aria-label={search.label}
          className="max-w-sm"
          data-testid={search.testId}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
          placeholder={search.placeholder ?? search.label}
          type="search"
          value={globalFilter}
        />
      ) : null}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table
          className="min-w-full border-collapse text-left text-sm"
          data-testid={tableTestId}
        >
          <thead>
            {headerGroups.map((headerGroup) => (
              <tr
                className="border-b border-border bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground"
                key={headerGroup.id}
              >
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();

                  return (
                    <th className="px-4 py-3 font-medium" key={header.id}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          className="inline-flex items-center gap-2 text-left text-inherit transition hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                          type="button"
                        >
                          <span>
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                          </span>
                          <span aria-hidden="true" className="text-[10px]">
                            {getSortIndicator(header.column.getIsSorted())}
                          </span>
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
            {showColumnFilters ? headerGroups.map((headerGroup) => (
              <tr
                className="border-b border-border bg-[var(--table-header-surface)] text-xs text-muted-foreground"
                key={`${headerGroup.id}-filters`}
              >
                {headerGroup.headers.map((header) => (
                  <th className="px-4 py-3 font-medium" key={`${header.id}-filter`}>
                    {header.isPlaceholder || !header.column.getCanFilter() ? null : (
                      <input
                        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs normal-case tracking-normal text-foreground placeholder:text-muted-foreground focus:border-[color:var(--status-active-border)]"
                        data-testid={`${filterTestIdPrefix}-${header.column.id}`}
                        onChange={(event) =>
                          header.column.setFilterValue(event.target.value)
                        }
                        placeholder={`Filter ${
                          header.column.columnDef.header?.toString() ??
                          header.column.id
                        }`}
                        type="search"
                        value={(header.column.getFilterValue() ?? "") as string}
                      />
                    )}
                  </th>
                ))}
              </tr>
            )) : null}
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row, index) => {
                const link = getRowLink?.(row.original);
                const linkProps = getRowLinkProps?.(row.original);
                const linkClassName = cn(
                  "inline-flex text-left hover:underline",
                  linkProps?.className,
                );

                return (
                  <tr
                    className="border-b border-border/70 align-top text-foreground transition hover:bg-[var(--table-row-hover-surface)]"
                    data-testid={rowTestId?.(row.original, index)}
                    key={row.id}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td className="px-4 py-4" key={cell.id}>
                        {link &&
                        cell.column.id === row.getVisibleCells()[0]?.column.id ? (
                          <a
                            {...linkProps}
                            className={linkClassName}
                            href={link}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </a>
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  className="px-4 py-6 text-muted-foreground"
                  colSpan={visibleColumnCount}
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageSize && pageCount > 1 ? (
        <nav
          aria-label="Pages"
          className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
        >
          <span>
            {firstShown}–{lastShown} of {matchingRowCount}
          </span>
          <div className="flex gap-2">
            <Button
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              size="sm"
              variant="secondary"
            >
              Previous
            </Button>
            <Button
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              size="sm"
              variant="secondary"
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
