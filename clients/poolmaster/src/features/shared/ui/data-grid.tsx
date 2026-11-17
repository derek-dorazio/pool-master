import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type RowData,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Fragment, useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router";
import { Button } from "./button";
import { cn } from "./class-names";
import { Input } from "./form-field";
import { Pager } from "./pager";
import { Tile } from "./tile";
import { ViewFilter, type ViewFilterOption } from "./view-filter";

/** One search box across the grid's text columns (rules/ux-rules.md §12 rule 7). */
export type DataGridSearch = {
  /** Accessible name of the search box, e.g. "Find a member". */
  label: string;
  placeholder?: string;
  testId?: string;
  /**
   * Hears every change to the box, for a list the server searches (#1180): the caller asks the
   * server for the term, and the grid still narrows what came back.
   */
  onChange?: (term: string) => void;
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

/**
 * The list's views (Active / History, Pending / Expired) as a `ViewFilter` in the grid's own
 * header, with the search box beside it at the right (rules/ux-rules.md §12 rule 7). The page
 * picks which rows to pass for the chosen view.
 */
export type DataGridViews = {
  /** Accessible name of the choice, e.g. "Contests to show". */
  label: string;
  onChange: (value: string) => void;
  options: ViewFilterOption[];
  value: string;
  /**
   * A filter that belongs to the chosen view, drawn just after the views, such as History's
   * season (a `FilterPicker`). A filter for the whole page stays in the `PageHeader`.
   */
  end?: ReactNode;
  /**
   * Drawn in the card in place of the table while the chosen view's rows load or fail to load
   * (a `LoadingState` or `ErrorState` of `size="inline"`),
   * so the views and search stay where they are.
   */
  status?: ReactNode;
};

/**
 * A row drawn under a grid row while it is open, such as a leaderboard entry's games: one cell
 * per column, keyed by column id, so each piece of detail sits under the column it belongs to.
 * A column the row leaves out stays empty.
 */
export type DataGridDetailRow = {
  id: string;
  cells: Partial<Record<string, ReactNode>>;
  /**
   * One cell across every column from `fromColumnId` to the end, in place of their own: for a
   * line that reads across the row rather than under one column.
   */
  span?: { fromColumnId: string; content: ReactNode };
  testId?: string;
};

export type DataGridProps<TData> = {
  // TanStack's ColumnDef<TData, TValue> is invariant in TValue, so a heterogeneous column
  // array cannot name a single TValue -- `unknown` rejects ColumnDef<Row, string>. `any` is
  // TanStack's own documented shape for this position.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  data: TData[];
  emptyMessage: string;
  filterTestIdPrefix?: string;
  getRowId?: (row: TData, index: number) => string;
  /**
   * Where a row leads: the whole row opens it (rules/ux-rules.md §12), and its first cell is the
   * link a keyboard reaches. Buttons, links and menus inside the row keep their own clicks.
   */
  getRowLink?: (row: TData) => string;
  getRowLinkProps?: (
    row: TData,
  ) => Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;
  rowTestId?: (row: TData, index: number) => string;
  /**
   * The row's quick actions, a `RowActionsMenu` ("⋯"), in a last column of its own. That column
   * stays pinned to the grid's right edge while a wide table scrolls sideways, so the "⋯" is in
   * reach on a phone without scrolling to it.
   */
  rowActions?: (row: TData) => ReactNode;
  tableTestId?: string;
  /**
   * Forwarded to `useReactTable({ meta })`. Lets a caller keep its column
   * definitions referentially stable while editable cells read live draft state
   * off `table.options.meta` (per-row draft editors — plans/124 §6.3 golf
   * roster / field).
   */
  meta?: Record<string, unknown>;
  /** Rows per page; omitted, every row shows on one page. */
  pageSize?: number;
  /** Whether each filterable column gets its own filter box. On by default. */
  showColumnFilters?: boolean;
  /** `scoreboard`: a leaderboard's header row, navy with gold column names. */
  headerTone?: "plain" | "scoreboard";
  /** The list's views, which put the views and the search in a header inside the grid's card. */
  views?: DataGridViews;
  /**
   * A control for the whole list drawn at the right end of the search row, such as a
   * leaderboard's "My entries" switch. The caller narrows `data` itself.
   */
  toolbarEnd?: ReactNode;
  /**
   * Names a narrowing the caller applies to `data` itself, such as "mine" or "all": when it
   * changes, the grid starts again from its first page, as it does for its own search.
   */
  pageResetKey?: string;
  /**
   * The rows drawn under a row, such as an opened leaderboard entry's games; none while it is
   * closed. The caller decides which rows are open.
   */
  detailRows?: (row: TData) => readonly DataGridDetailRow[];
  /**
   * A row to open the grid on, such as the entry a link names: once it is among the rows, the
   * grid turns to its page, highlights it as a jump does and scrolls it into view, once per id.
   * An id the grid doesn't hold is ignored.
   */
  landOnRowId?: string | null;
} & (
  | {
      /** A search box above the grid matching any text column. Off by default. */
      search?: DataGridSearch;
      searchTerm?: never;
      jumpToRow?: DataGridJumpToRow;
    }
  | {
      /**
       * The term from a search box the page draws itself, such as in its `PageHeader`'s right
       * slot. The grid narrows to it as it would to its own box. A jump to a row can't clear a
       * box the grid doesn't own, so the two never go together.
       */
      searchTerm: string;
      search?: never;
      jumpToRow?: never;
    }
);

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the generics must match TanStack's own declaration to merge with it.
  interface ColumnMeta<TData extends RowData, TValue> {
    /**
     * `start`: the column stays pinned to the grid's left edge while the rest scroll sideways
     * under it, such as a leaderboard's Entry column on a phone.
     */
    pinned?: "start";
  }
}

/**
 * The words a column's filter box names it by: its header when that is text, else its id. A header
 * drawn by a function is rendered as a component, so it is never called or turned into a string
 * here, which would print its source; a column that needs words of its own gives a text header.
 */
function filterLabel(header: unknown, columnId: string): string {
  return typeof header === "string" ? header : columnId;
}

/** A column pinned at the start: stuck to the left edge, over the cells scrolling under it. */
const PINNED_START_CELL = "sticky left-0 z-[1]";
/** A pinned body cell's solid fill, with the row's hover laid over it like the cells around it. */
const PINNED_BODY_SURFACE =
  "bg-card group-hover:[background-image:linear-gradient(var(--table-row-hover-surface),var(--table-row-hover-surface))]";

/** The row actions' column: pinned to the right edge, over the cells scrolling under it. */
const PINNED_END_CELL = "sticky right-0 z-[1] text-right";
/** The header's tint laid over the card, so the pinned header cell is solid in both themes. */
const PINNED_PLAIN_HEADER_SURFACE =
  "bg-card [background-image:linear-gradient(var(--table-header-surface),var(--table-header-surface))]";

/**
 * A detail row's cells, one per column up to its span, then the span as one cell across the rest.
 */
function detailCells<TData>(columns: Column<TData>[], detail: DataGridDetailRow): Array<{ column: Column<TData>; colSpan: number }> {
  const spanStart = detail.span ? columns.findIndex((column) => column.id === detail.span?.fromColumnId) : -1;
  if (spanStart < 0) {
    return columns.map((column) => ({ column, colSpan: 1 }));
  }
  return [
    ...columns.slice(0, spanStart).map((column) => ({ column, colSpan: 1 })),
    { column: columns[spanStart], colSpan: columns.length - spanStart },
  ];
}

/** Something in a row that takes its own click, so a click on it never opens the row. */
const OWN_CLICK_SELECTOR = "a, button, input, select, textarea, label, [role='menuitem']";

/**
 * A click on a linked row opens it through the row's link, as if the link were clicked: the
 * router moves, and the link's own `onClick` runs. A click on a control in the row, one that
 * reaches the row from a dialog or menu drawn elsewhere on the page, or the end of selecting the
 * row's text does not.
 */
function openRowFromClick(event: MouseEvent<HTMLTableRowElement>) {
  const target = event.target;
  if (!(target instanceof Element) || !event.currentTarget.contains(target)) {
    return;
  }
  if (target.closest(OWN_CLICK_SELECTOR) || window.getSelection()?.toString()) {
    return;
  }
  event.currentTarget.querySelector<HTMLAnchorElement>("a[data-row-link]")?.click();
}

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
  rowActions,
  tableTestId,
  meta,
  search,
  searchTerm,
  pageSize,
  showColumnFilters = true,
  jumpToRow,
  headerTone = "plain",
  views,
  toolbarEnd,
  pageResetKey,
  detailRows,
  landOnRowId = null,
}: DataGridProps<TData>) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [ownSearchTerm, setOwnSearchTerm] = useState("");
  const globalFilter = searchTerm ?? ownSearchTerm;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSize ?? Number.MAX_SAFE_INTEGER,
  });

  // The last row jumped to: it stays highlighted until the next jump.
  const [jumpedRowId, setJumpedRowId] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  // The row the grid last landed on (`landOnRowId`), so a later render leaves the viewer's page alone.
  const [landedRowId, setLandedRowId] = useState<string | null>(null);
  useEffect(() => {
    if (landedRowId === null) {
      return;
    }
    tableRef.current
      ?.querySelector(`[data-row-id="${CSS.escape(landedRowId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [landedRowId]);

  const resetPageIndex = () =>
    setPagination((current) => ({ ...current, pageIndex: 0 }));

  // A new term from the page's own box starts again from the first page, as the grid's box does.
  const [pagedSearchTerm, setPagedSearchTerm] = useState(searchTerm);
  if (searchTerm !== pagedSearchTerm) {
    setPagedSearchTerm(searchTerm);
    resetPageIndex();
  }

  // So does another narrowing the caller applies, such as a leaderboard's My entries.
  const [pagedResetKey, setPagedResetKey] = useState(pageResetKey);
  if (pageResetKey !== pagedResetKey) {
    setPagedResetKey(pageResetKey);
    resetPageIndex();
  }

  // Another view starts again from the first page and keeps what was typed in the search.
  const [pagedView, setPagedView] = useState(views?.value);
  if (views?.value !== pagedView) {
    setPagedView(views?.value);
    resetPageIndex();
  }

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
      setOwnSearchTerm(updater);
      resetPageIndex();
    },
    onPaginationChange: setPagination,
    onSortingChange: (updater) => {
      setSorting(updater);
      resetPageIndex();
    },
    getRowId,
  });

  // The pinned header cell needs a solid fill, or the column names scroll through it.
  const pinnedHeaderSurface = headerTone === "scoreboard" ? "bg-surface-inverse" : PINNED_PLAIN_HEADER_SURFACE;
  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const visibleColumnCount = useMemo(
    () => table.getVisibleLeafColumns().length + (rowActions ? 1 : 0),
    [rowActions, table],
  );

  const canJump = jumpToRow !== undefined && table.getCoreRowModel().rows.some((row) => row.id === jumpToRow.rowId);

  // Each step renders before the next reads it: the unfiltered rows say which page holds the row,
  // and that page is in the table to scroll to. A repeat jump scrolls again; a sort or page never does.
  const jump = (rowId: string) => {
    flushSync(() => {
      setOwnSearchTerm("");
      setColumnFilters([]);
    });
    const index = table.getSortedRowModel().rows.findIndex((row) => row.id === rowId);
    if (index < 0) {
      return;
    }
    flushSync(() => {
      setPagination((current) => ({ ...current, pageIndex: Math.floor(index / current.pageSize) }));
      setJumpedRowId(rowId);
    });
    tableRef.current
      ?.querySelector(`[data-row-id="${CSS.escape(rowId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  if (landOnRowId !== null && landOnRowId !== landedRowId) {
    const index = table.getSortedRowModel().rows.findIndex((row) => row.id === landOnRowId);
    if (index >= 0) {
      setLandedRowId(landOnRowId);
      setJumpedRowId(landOnRowId);
      setPagination((current) => ({ ...current, pageIndex: Math.floor(index / current.pageSize) }));
    }
  }

  const matchingRowCount = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  if (pagination.pageIndex > 0 && pagination.pageIndex >= pageCount) {
    // The caller passed fewer rows than before (a refetch, or a narrower filter of its own):
    // show the last page there still is rather than an empty one.
    setPagination({ ...pagination, pageIndex: Math.max(pageCount - 1, 0) });
  }

  const searchBox = search ? (
    <Input
      aria-label={search.label}
      className={views ? undefined : "max-w-sm"}
      data-testid={search.testId}
      onChange={(event) => {
        table.setGlobalFilter(event.target.value);
        search.onChange?.(event.target.value);
      }}
      placeholder={search.placeholder ?? search.label}
      type="search"
      value={globalFilter}
    />
  ) : null;
  const jumpButton = jumpToRow && canJump ? (
    <Button
      data-testid={jumpToRow.testId}
      onClick={() => jump(jumpToRow.rowId)}
      size="sm"
      variant="secondary"
    >
      {jumpToRow.label}
    </Button>
  ) : null;

  return (
    <div className="grid gap-3">
      {!views && (search || canJump || toolbarEnd) ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            {searchBox}
            {jumpButton}
          </div>
          {toolbarEnd}
        </div>
      ) : null}
      <Tile className="overflow-hidden" padding="none">
        {views ? (
          // The views read from the left and the search sits at the right; on a phone the search
          // takes its own line under the views.
          <div className="flex flex-wrap items-end justify-between gap-x-4 border-b border-border px-4">
            <div className="flex min-w-0 flex-wrap items-end gap-x-4">
              <ViewFilter aria-label={views.label} onChange={views.onChange} options={views.options} value={views.value} />
              {views.end ? <div className="flex items-center pb-1.5" data-testid={tableTestId ? `${tableTestId}-views-end` : undefined}>{views.end}</div> : null}
            </div>
            {searchBox || jumpButton || toolbarEnd ? (
              <div className="flex w-full items-center gap-2 pb-2 sm:w-auto sm:pt-2 max-sm:pt-1">
                {searchBox ? <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">{searchBox}</div> : null}
                {jumpButton}
                {toolbarEnd}
              </div>
            ) : null}
          </div>
        ) : null}
        {views?.status ? views.status : (
        <div className="overflow-x-auto">
          <table
            className="min-w-full border-collapse text-left text-sm"
            data-testid={tableTestId}
            ref={tableRef}
          >
            <thead>
              {headerGroups.map((headerGroup) => (
                <tr
                  className={cn(
                    "border-b border-border text-xs uppercase",
                    headerTone === "scoreboard"
                      ? "bg-surface-inverse text-primary"
                      : "bg-[var(--table-header-surface)] text-muted-foreground",
                  )}
                  key={headerGroup.id}
                >
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();

                    return (
                      <th
                        className={cn(
                          "px-4 py-3 font-medium",
                          header.column.columnDef.meta?.pinned === "start" && [PINNED_START_CELL, pinnedHeaderSurface],
                        )}
                        key={header.id}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            className={cn(
                              "inline-flex items-center gap-2 text-left text-inherit transition",
                              headerTone === "scoreboard" ? "hover:text-on-inverse" : "hover:text-foreground",
                            )}
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
                  {rowActions ? (
                    <th className={cn(PINNED_END_CELL, "w-px px-2 py-3", pinnedHeaderSurface)} key="row-actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
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
                          placeholder={`Filter ${filterLabel(header.column.columnDef.header, header.column.id)}`}
                          type="search"
                          value={(header.column.getFilterValue() ?? "") as string}
                        />
                      )}
                    </th>
                  ))}
                  {rowActions ? <th className={cn(PINNED_END_CELL, PINNED_PLAIN_HEADER_SURFACE)} key="row-actions-filter" /> : null}
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
                    <Fragment key={row.id}>
                      <tr
                        aria-current={row.id === jumpedRowId ? "true" : undefined}
                        className={cn(
                          "group border-b border-border/70 align-top text-foreground transition hover:bg-[var(--table-row-hover-surface)]",
                          link && "cursor-pointer",
                          row.id === jumpedRowId && "bg-[var(--status-active-surface)]",
                        )}
                        data-row-id={row.id}
                        data-testid={rowTestId?.(row.original, index)}
                        onClick={link ? openRowFromClick : undefined}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            className={cn(
                              "px-4 py-4",
                              cell.column.columnDef.meta?.pinned === "start" && [PINNED_START_CELL, PINNED_BODY_SURFACE],
                            )}
                            key={cell.id}
                          >
                            {link &&
                            cell.column.id === row.getVisibleCells()[0]?.column.id ? (
                              <Link
                                {...linkProps}
                                className={linkClassName}
                                data-row-link=""
                                to={link}
                              >
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext(),
                                )}
                              </Link>
                            ) : (
                              flexRender(cell.column.columnDef.cell, cell.getContext())
                            )}
                          </td>
                        ))}
                        {rowActions ? (
                          <td
                            className={cn(
                              PINNED_END_CELL,
                              "w-px bg-card px-2 py-3 group-hover:[background-image:linear-gradient(var(--table-row-hover-surface),var(--table-row-hover-surface))]",
                            )}
                            data-testid="data-grid-row-actions"
                          >
                            {rowActions(row.original)}
                          </td>
                        ) : null}
                      </tr>
                      {detailRows?.(row.original).map((detail) => (
                        <tr
                          className="border-b border-border/40 align-top text-sm text-foreground"
                          data-testid={detail.testId}
                          key={`${row.id}-${detail.id}`}
                        >
                          {detailCells(row.getVisibleCells().map((cell) => cell.column), detail).map(({ column, colSpan }) => (
                            <td
                              className={cn(
                                "px-4 py-2",
                                column.columnDef.meta?.pinned === "start" && [PINNED_START_CELL, "bg-card"],
                              )}
                              colSpan={colSpan}
                              key={column.id}
                            >
                              {detail.span?.fromColumnId === column.id ? detail.span.content : detail.cells[column.id]}
                            </td>
                          ))}
                          {rowActions ? <td className={cn(PINNED_END_CELL, "bg-card")} /> : null}
                        </tr>
                      ))}
                    </Fragment>
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
        )}
      </Tile>
      {pageSize && !views?.status ? (
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
