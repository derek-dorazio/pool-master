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
import { useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes } from "react";
import { Button } from "./button";
import { cn } from "./class-names";
import { Input } from "./form-field";
import { Pager } from "./pager";
import { Tile } from "./tile";

/** One search box across the grid's text columns (rules/ux-rules.md §12 rule 7). */
export type DataGridSearch = {
  /** Accessible name of the search box, e.g. "Find a member". */
  label: string;
  placeholder?: string;
  testId?: string;
};

/**
 * A "jump to my row" action (rules/ux-rules.md §12 rule 7): clears the search and filters, turns
 * to the page holding the row in the current sort, scrolls to it and highlights it. Needs
 * `getRowId`; the button shows only while the row is in the data.
 */
export type DataGridJumpToRow = {
  rowId: string;
  /** The button's text, e.g. "Jump to Casey Crushers". */
  label: string;
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
  jumpToRow?: DataGridJumpToRow;
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
  jumpToRow,
}: DataGridProps<TData>) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSize ?? Number.MAX_SAFE_INTEGER,
  });

  // Set by the jump action until the unfiltered rows render; then its page is turned to.
  const [pendingJumpRowId, setPendingJumpRowId] = useState<string | null>(null);
  // The last jump that landed: its row stays highlighted until the next jump. A new object per
  // jump, so a repeat jump to the same row scrolls again and nothing else (a sort, a page) does.
  const [landedJump, setLandedJump] = useState<{ rowId: string } | null>(null);
  const jumpedRowId = landedJump?.rowId ?? null;
  const tableRef = useRef<HTMLTableElement>(null);

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

  const sortedRows = table.getSortedRowModel().rows;
  const isUnfiltered = globalFilter === "" && columnFilters.length === 0;
  const canJump = jumpToRow !== undefined && table.getCoreRowModel().rows.some((row) => row.id === jumpToRow.rowId);

  useEffect(() => {
    if (pendingJumpRowId === null || !isUnfiltered) {
      return;
    }
    const index = sortedRows.findIndex((row) => row.id === pendingJumpRowId);
    setPendingJumpRowId(null);
    if (index < 0) {
      return;
    }
    setPagination((current) => ({ ...current, pageIndex: Math.floor(index / current.pageSize) }));
    setLandedJump({ rowId: pendingJumpRowId });
  }, [isUnfiltered, pendingJumpRowId, sortedRows]);

  // Runs after the render that turned to the row's page, so the row is there to scroll to.
  useEffect(() => {
    if (landedJump === null) {
      return;
    }
    tableRef.current
      ?.querySelector(`[data-row-id="${CSS.escape(landedJump.rowId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [landedJump]);

  const jump = (rowId: string) => {
    setGlobalFilter("");
    setColumnFilters([]);
    setPendingJumpRowId(rowId);
  };

  const matchingRowCount = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  if (pagination.pageIndex > 0 && pagination.pageIndex >= pageCount) {
    // The caller passed fewer rows than before (a refetch, or a narrower filter of its own):
    // show the last page there still is rather than an empty one.
    setPagination({ ...pagination, pageIndex: Math.max(pageCount - 1, 0) });
  }

  return (
    <div className="grid gap-3">
      {search || canJump ? (
        <div className="flex flex-wrap items-center gap-3">
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
          {jumpToRow && canJump ? (
            <Button
              data-testid={jumpToRow.testId}
              onClick={() => jump(jumpToRow.rowId)}
              size="sm"
              variant="secondary"
            >
              {jumpToRow.label}
            </Button>
          ) : null}
        </div>
      ) : null}
      <Tile className="overflow-x-auto" padding="none" radius="md">
        <table
          className="min-w-full border-collapse text-left text-sm"
          data-testid={tableTestId}
          ref={tableRef}
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
                        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-base normal-case sm:text-xs tracking-normal text-foreground placeholder:text-muted-foreground focus:border-[color:var(--status-active-border)]"
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
                    aria-current={row.id === jumpedRowId ? "true" : undefined}
                    className={cn(
                      "border-b border-border/70 align-top text-foreground transition hover:bg-[var(--table-row-hover-surface)]",
                      row.id === jumpedRowId && "bg-[var(--status-active-surface)]",
                    )}
                    data-row-id={row.id}
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
      </Tile>
      {pageSize ? (
        <Pager
          onNext={() => table.nextPage()}
          onPrevious={() => table.previousPage()}
          pageCount={pageCount}
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          total={matchingRowCount}
        />
      ) : null}
    </div>
  );
}
