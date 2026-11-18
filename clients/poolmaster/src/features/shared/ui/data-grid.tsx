import {
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
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
import { ChevronRight, Info, Maximize2 } from "lucide-react";
import { Link } from "react-router";
import { Button } from "./button";
import { cn } from "./class-names";
import { Input } from "./form-field";
import { InfoPopover } from "./info-popover";
import { Pager } from "./pager";
import { Tile } from "./tile";
import { ViewFilter, type ViewFilterOption } from "./view-filter";
import { DataGridColumnFilter } from "./data-grid-column-filter";
import { DataGridFilterSummary } from "./data-grid-filter-summary";
import { DataGridSortButton } from "./data-grid-sort-button";
import {
  columnTypeClassName,
  getBlanksLastSortedRowModel,
  initialFilters,
  withGridFilters,
  type DataGridColumnType,
} from "./data-grid-filters";
import { useDisplayPreferences } from "./display-preferences";

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
  /**
   * A filterable column needs a text header: its filter is named by it, else by the raw column id.
   * A column whose `meta.options` names its fixed set of values filters by ticking them.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  data: TData[];
  emptyMessage: string;
  filterTestIdPrefix?: string;
  getRowId?: (row: TData, index: number) => string;
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
  /** Whether each filterable column's header offers its filter. On by default. */
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
) & (
  | {
      /**
       * Where a row leads: the whole row opens it (rules/ux-rules.md §12), its first cell is the
       * link a keyboard reaches, and a › at its right end says so. Buttons, links and menus
       * inside the row keep their own clicks.
       */
      getRowLink?: (row: TData) => string;
      getRowLinkProps?: (
        row: TData,
      ) => Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;
      openRowDialog?: never;
    }
  | {
      /**
       * Opens a row's details in a dialog: the whole row opens it, and a ⤢ button at its right
       * end is the way in a keyboard reaches. A row leads to a page or opens a dialog, never both.
       */
      openRowDialog: (row: TData) => void;
      getRowLink?: never;
      getRowLinkProps?: never;
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
    /**
     * What the column holds and why, in one or two plain sentences of product copy: a small (i)
     * after the column's name shows it. Explanations live only here, never as text on the page.
     */
    info?: string;
    /**
     * What the column holds (`DataGridColumnType`): text, a value from a fixed set, yes/no, a
     * number, a date or a date range. The grid supplies its filter, its sort and, for numbers
     * and dates, the cell's look. A column with no type neither sorts nor filters.
     */
    type?: DataGridColumnType;
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
 * router moves, and the link's own `onClick` runs. A row that opens a dialog does the same
 * through its ⤢ button. A click on a control in the row, one that
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
  event.currentTarget.querySelector<HTMLElement>("a[data-row-link], button[data-row-dialog]")?.click();
}

/** What a header tells a screen reader about its column's sort. */
const ARIA_SORT: Record<string, "ascending" | "descending" | undefined> = { asc: "ascending", desc: "descending" };

export function DataGrid<TData>({
  columns,
  data,
  emptyMessage,
  filterTestIdPrefix = "data-grid-filter",
  getRowId,
  getRowLink,
  getRowLinkProps,
  openRowDialog,
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
  // Null until the first render reads which enumerated columns start on some values only.
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState | null>(null);
  const preferences = useDisplayPreferences();
  const gridColumns = useMemo(() => withGridFilters(columns, preferences), [columns, preferences]);
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
    columns: gridColumns,
    meta,
    // A click sorts ascending, then descending, then not at all, one column at a time. Blank
    // cells sort last whichever way (`getBlanksLastSortedRowModel`).
    sortDescFirst: false,
    enableMultiSort: false,
    state: {
      columnFilters: columnFilters ?? [],
      globalFilter,
      pagination,
      sorting,
    },
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getBlanksLastSortedRowModel(),
    // A new search, filter or sort starts again from the first page.
    onColumnFiltersChange: (updater) => {
      setColumnFilters((current) => functionalUpdate(updater, current ?? []));
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

  // The columns' `initial` selections are read once, on the first render; a column that gains
  // one later (columns built after the data loads) does not apply it.
  if (columnFilters === null) {
    setColumnFilters(initialFilters(table));
  }

  // The pinned header cell needs a solid fill, or the column names scroll through it.
  // The pinned last column: the row's actions, then the › or ⤢ that says what the row opens.
  const hasEndColumn = Boolean(rowActions ?? getRowLink ?? openRowDialog);
  const pinnedHeaderSurface = headerTone === "scoreboard" ? "bg-surface-inverse" : PINNED_PLAIN_HEADER_SURFACE;
  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const visibleColumnCount = useMemo(
    () => table.getVisibleLeafColumns().length + (hasEndColumn ? 1 : 0),
    [hasEndColumn, table],
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
      {showColumnFilters ? (
        <DataGridFilterSummary
          labelOf={(columnId) => filterLabel(table.getColumn(columnId)?.columnDef.header, columnId)}
          table={table}
          testId={`${filterTestIdPrefix}-summary`}
        />
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
                    const { column } = header;
                    const canFilter = showColumnFilters && column.getCanFilter();
                    const name = flexRender(column.columnDef.header, header.getContext());
                    const columnInfo = column.columnDef.meta?.info;
                    const info = columnInfo ? (
                      <InfoPopover
                        icon={<Info aria-hidden className="size-3.5" />}
                        label={`About ${filterLabel(column.columnDef.header, column.id)}`}
                        look="tooltip"
                        testId={`data-grid-info-${column.id}`}
                        trigger="inline"
                      >
                        <span className="block text-left text-sm font-normal normal-case leading-snug tracking-normal">
                          {columnInfo}
                        </span>
                      </InfoPopover>
                    ) : null;

                    return (
                      <th
                        aria-sort={ARIA_SORT[String(column.getIsSorted())]}
                        className={cn(
                          "group/header px-4 py-3 font-medium",
                          column.columnDef.meta?.type?.kind === "number" && "text-right",
                          column.columnDef.meta?.pinned === "start" && [PINNED_START_CELL, pinnedHeaderSurface],
                        )}
                        key={header.id}
                      >
                        {header.isPlaceholder ? null : (
                          <span className="inline-flex items-center gap-1.5">
                            {column.getCanSort() ? (
                              <DataGridSortButton
                                direction={column.getIsSorted()}
                                info={info}
                                onClick={() => column.toggleSorting(undefined, false)}
                                testId={`data-grid-sort-${column.id}`}
                                tone={headerTone}
                              >
                                {name}
                              </DataGridSortButton>
                            ) : (
                              <>
                                {name}
                                {info}
                              </>
                            )}
                            {canFilter ? (
                              <DataGridColumnFilter
                                column={column}
                                label={filterLabel(column.columnDef.header, column.id)}
                                table={table}
                                testId={`${filterTestIdPrefix}-${column.id}`}
                              />
                            ) : null}
                          </span>
                        )}
                      </th>
                    );
                  })}
                  {hasEndColumn ? (
                    <th className={cn(PINNED_END_CELL, "w-px px-2 py-3", pinnedHeaderSurface)} key="row-actions">
                      <span className="sr-only">{rowActions ? "Actions" : "Open"}</span>
                    </th>
                  ) : null}
                </tr>
              ))}
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
                        onClick={link || openRowDialog ? openRowFromClick : undefined}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            className={cn(
                              "px-4 py-4",
                              columnTypeClassName(cell.column.columnDef.meta?.type),
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
                        {hasEndColumn ? (
                          <td
                            className={cn(
                              PINNED_END_CELL,
                              "w-px bg-card px-2 py-3 group-hover:[background-image:linear-gradient(var(--table-row-hover-surface),var(--table-row-hover-surface))]",
                            )}
                            data-testid="data-grid-row-actions"
                          >
                            <span className="inline-flex items-center justify-end gap-1">
                              {rowActions?.(row.original)}
                              {link ? (
                                <ChevronRight
                                  aria-hidden="true"
                                  className="size-4 text-muted-foreground"
                                  data-testid="data-grid-row-opens-page"
                                />
                              ) : null}
                              {openRowDialog ? (
                                <button
                                  aria-label="Open details"
                                  className="inline-flex rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                  data-row-dialog=""
                                  data-testid="data-grid-row-opens-dialog"
                                  onClick={() => openRowDialog(row.original)}
                                  type="button"
                                >
                                  <Maximize2 aria-hidden="true" className="size-4" />
                                </button>
                              ) : null}
                            </span>
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
                          {hasEndColumn ? <td className={cn(PINNED_END_CELL, "bg-card")} /> : null}
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
