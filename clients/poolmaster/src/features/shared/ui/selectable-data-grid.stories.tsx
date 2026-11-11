import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { SelectableDataGrid } from "./selectable-data-grid";

type Golfer = { id: string; name: string; rank: number };
const GOLFERS: Golfer[] = [
  { id: "1", name: "Scottie Scheffler", rank: 1 },
  { id: "2", name: "Rory McIlroy", rank: 2 },
  { id: "3", name: "Xander Schauffele", rank: 3 },
  { id: "4", name: "Ludvig Åberg", rank: 4 },
];
const COLUMNS: ColumnDef<Golfer>[] = [
  { accessorKey: "rank", header: "Rank" },
  { accessorKey: "name", header: "Golfer" },
];

function SelectableDemo() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(["2"]));
  return (
    <SelectableDataGrid
      columns={COLUMNS}
      data={GOLFERS}
      emptyMessage="No golfers."
      getRowId={(golfer) => golfer.id}
      getRowLabel={(golfer) => golfer.name}
      onToggle={(id) => setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      })}
      onToggleAll={(ids, nextSelected) => setSelected(nextSelected ? new Set(ids) : new Set())}
      selectedIds={selected}
    />
  );
}

const meta = {
  title: "Tables/SelectableDataGrid",
  component: SelectableDemo,
} satisfies Meta<typeof SelectableDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
