import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';

type AdminDataGridProps<TData> = {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  emptyMessage: string;
  getRowId?: (row: TData, index: number) => string;
  getRowLink?: (row: TData) => string;
  rowTestId?: (row: TData, index: number) => string;
  tableTestId?: string;
};

function getSortIndicator(direction: false | 'asc' | 'desc') {
  if (direction === 'asc') {
    return '▲';
  }

  if (direction === 'desc') {
    return '▼';
  }

  return '↕';
}

export function AdminDataGrid<TData>({
  columns,
  data,
  emptyMessage,
  getRowId,
  getRowLink,
  rowTestId,
  tableTestId,
}: AdminDataGridProps<TData>) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: {
      columnFilters,
      sorting,
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    getRowId,
  });

  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;
  const visibleColumnCount = useMemo(
    () => table.getVisibleLeafColumns().length,
    [table],
  );

  return (
    <div className="overflow-x-auto">
      <table
        className="min-w-full border-collapse text-left text-sm"
        data-testid={tableTestId}
      >
        <thead>
          {headerGroups.map((headerGroup) => (
            <tr
              className="border-b border-border text-xs uppercase tracking-[0.18em] text-muted-foreground"
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
          {headerGroups.map((headerGroup) => (
            <tr
              className="border-b border-border bg-background/60 text-xs text-muted-foreground"
              key={`${headerGroup.id}-filters`}
            >
              {headerGroup.headers.map((header) => (
                <th className="px-4 py-3 font-medium" key={`${header.id}-filter`}>
                  {header.isPlaceholder || !header.column.getCanFilter() ? null : (
                    <input
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-xs normal-case tracking-normal text-foreground placeholder:text-muted-foreground"
                      data-testid={`admin-grid-filter-${header.column.id}`}
                      onChange={(event) => header.column.setFilterValue(event.target.value)}
                      placeholder={`Filter ${header.column.columnDef.header?.toString() ?? header.column.id}`}
                      type="search"
                      value={(header.column.getFilterValue() ?? '') as string}
                    />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row, index) => {
              const link = getRowLink?.(row.original);

              return (
                <tr
                  className="border-b border-border/70 align-top text-foreground transition hover:bg-background/80"
                  data-testid={rowTestId?.(row.original, index)}
                  key={row.id}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td className="px-4 py-4" key={cell.id}>
                      {link && cell.column.id === row.getVisibleCells()[0]?.column.id ? (
                        <a
                          className="inline-flex text-left hover:underline"
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
  );
}
