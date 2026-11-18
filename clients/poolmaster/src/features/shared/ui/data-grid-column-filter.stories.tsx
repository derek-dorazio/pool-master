import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "./data-grid";
import { optionsFromLabels } from "./data-grid-filters";

type Sport = { id: string; name: string; leagueKind: string };

const KINDS = { REAL: "Real", CLUTCH_CARD: "Clutch Card" };
const LEAGUES: Sport[] = [
  { id: "1", name: "MLB", leagueKind: "REAL" },
  { id: "2", name: "World Series", leagueKind: "CLUTCH_CARD" },
  { id: "3", name: "NBA", leagueKind: "REAL" },
];
const COLUMNS: ColumnDef<Sport>[] = [
  { accessorKey: "name", header: "Sport league", meta: { type: { kind: "text" } } },
  {
    accessorKey: "leagueKind",
    header: "Kind",
    meta: { type: { kind: "enum", values: optionsFromLabels(KINDS) } },
    cell: ({ getValue }) => KINDS[getValue<keyof typeof KINDS>()],
  },
];

function KindFilter() {
  return <DataGrid columns={COLUMNS} data={LEAGUES} emptyMessage="No sport leagues match." getRowId={(league) => league.id} />;
}

const meta = {
  title: "Tables/DataGridColumnFilter",
  component: KindFilter,
} satisfies Meta<typeof KindFilter>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A `DataGrid` column's filter, drawn by its header's funnel: Kind is an enum column (a checkbox
 * per value), Sport league a text column (contains).
 */
export const EnumAndText: Story = {};
