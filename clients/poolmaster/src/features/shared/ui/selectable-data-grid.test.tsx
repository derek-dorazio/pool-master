import { createColumnHelper } from '@tanstack/react-table';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SelectableDataGrid } from './selectable-data-grid';

// plans/124 §6.4 — DataGrid + checkbox column + header select-all (pool-master-za4).

type Row = { id: string; name: string };
const columnHelper = createColumnHelper<Row>();
const columns = [columnHelper.accessor('name', { header: 'Name', cell: ({ getValue }) => getValue() })];

function Harness({ data }: { data: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <>
      <p data-testid="count">{selected.size}</p>
      <SelectableDataGrid
        columns={columns}
        data={data}
        emptyMessage="none"
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        onToggle={(id) =>
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) {
              next.delete(id);
            } else {
              next.add(id);
            }
            return next;
          })
        }
        onToggleAll={(ids, nextSelected) =>
          setSelected((current) => {
            const next = new Set(current);
            ids.forEach((id) => {
              if (nextSelected) {
                next.add(id);
              } else {
                next.delete(id);
              }
            });
            return next;
          })
        }
        selectTestIdPrefix="sel"
        selectedIds={selected}
      />
    </>
  );
}

describe('pool-master-za4 SelectableDataGrid', () => {
  const rows = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ];

  it('pool-master-za4 toggles a single row', async () => {
    render(<Harness data={rows} />);
    await userEvent.click(screen.getByTestId('sel-a'));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    await userEvent.click(screen.getByTestId('sel-a'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('pool-master-za4 select-all checks every visible row and reflects the all-selected state', async () => {
    render(<Harness data={rows} />);
    const all = screen.getByTestId('sel-all');
    expect(all).not.toBeChecked();

    await userEvent.click(all);
    expect(screen.getByTestId('count')).toHaveTextContent('2');
    expect(screen.getByTestId('sel-all')).toBeChecked();

    await userEvent.click(screen.getByTestId('sel-all'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('pool-master-za4 puts the select-all box in an indeterminate state for a partial selection', async () => {
    render(<Harness data={rows} />);
    await userEvent.click(screen.getByTestId('sel-a'));

    const all = screen.getByTestId('sel-all') as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    expect(all).not.toBeChecked();
  });

  it('pool-master-za4 uses getRowLabel for the row checkbox accessible name', () => {
    render(<Harness data={rows} />);
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toBeInTheDocument();
  });
});
