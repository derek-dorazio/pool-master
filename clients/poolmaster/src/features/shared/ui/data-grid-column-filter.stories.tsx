import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "./data-grid";
import { optionsFromLabels } from "../../../test/data-grid-options";

type Team = { id: string; name: string; conference: string };

const CONFERENCES = { EAST: "East", WEST: "West" };
const TEAMS: Team[] = [
  { id: "1", name: "Boston Celtics", conference: "EAST" },
  { id: "2", name: "Denver Nuggets", conference: "WEST" },
  { id: "3", name: "New York Knicks", conference: "EAST" },
];
const COLUMNS: ColumnDef<Team>[] = [
  { accessorKey: "name", header: "Team", meta: { type: { kind: "text" } } },
  {
    accessorKey: "conference",
    header: "Conference",
    meta: { type: { kind: "enum", values: optionsFromLabels(CONFERENCES) } },
    cell: ({ getValue }) => CONFERENCES[getValue<keyof typeof CONFERENCES>()],
  },
];

function ConferenceFilter() {
  return <DataGrid columns={COLUMNS} data={TEAMS} emptyMessage="No teams match." getRowId={(team) => team.id} />;
}

const meta = {
  title: "Tables/DataGridColumnFilter",
  component: ConferenceFilter,
} satisfies Meta<typeof ConferenceFilter>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A `DataGrid` column's filter, drawn by its header's funnel: Conference is an enum column (a checkbox
 * per value), Team a text column (contains).
 */
export const EnumAndText: Story = {};
