import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "./data-grid";
import { optionsFromLabels } from "./data-grid-filters";

type League = { id: string; name: string; state: string };

const STATES = { ON: "On", OFF: "Off" };
const LEAGUES: League[] = [
  { id: "1", name: "MLB", state: "ON" },
  { id: "2", name: "NBA", state: "ON" },
  { id: "3", name: "PWHL", state: "OFF" },
];
const COLUMNS: ColumnDef<League>[] = [
  { accessorKey: "name", header: "Sport league" },
  {
    accessorKey: "state",
    header: "Status",
    meta: { type: { kind: "enum", values: optionsFromLabels(STATES), initial: ["ON"] } },
    cell: ({ getValue }) => STATES[getValue<keyof typeof STATES>()],
  },
];

function FilteredLeagues() {
  return <DataGrid columns={COLUMNS} data={LEAGUES} emptyMessage="No sport leagues match." getRowId={(league) => league.id} />;
}

const meta = {
  title: "Tables/DataGridFilterSummary",
  component: FilteredLeagues,
} satisfies Meta<typeof FilteredLeagues>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The line over a filtered `DataGrid`: each filter in force, rows shown of all, and Clear all filters. */
export const StartsFiltered: Story = {};
