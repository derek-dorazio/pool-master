import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "./data-grid";

type League = {
  id: string;
  name: string;
  members: number;
  active: boolean;
  lastRun: string | null;
  starts: string;
  season: { start: string | null; end: string | null } | null;
};

const LEAGUES: League[] = [
  { id: "1", name: "NBA", members: 120, active: true, lastRun: "2026-11-18T13:05:00.000Z", starts: "2026-10-21", season: { start: "2026-10-21", end: "2027-06-18" } },
  { id: "2", name: "MLB", members: 9, active: true, lastRun: "2026-11-17T22:40:00.000Z", starts: "2027-03-25", season: { start: "2027-03-25", end: "2027-11-01" } },
  { id: "3", name: "NHL", members: 10, active: false, lastRun: null, starts: "2026-10-07", season: { start: "2026-10-07", end: null } },
  { id: "4", name: "WNBA", members: 42, active: true, lastRun: "2026-09-30T18:00:00.000Z", starts: "2027-05-15", season: null },
];

const COLUMNS: ColumnDef<League>[] = [
  { accessorKey: "name", header: "Sport league", meta: { type: { kind: "text" } } },
  { accessorKey: "members", header: "Members", meta: { type: { kind: "number" } } },
  { accessorKey: "active", header: "Active", meta: { type: { kind: "boolean" } } },
  { accessorKey: "lastRun", header: "Last run", meta: { type: { kind: "datetime", direction: "past", blank: "Never" } } },
  { accessorKey: "starts", header: "Starts", meta: { type: { kind: "date", direction: "both", format: "numeric" } } },
  { accessorKey: "season", header: "Season", meta: { type: { kind: "dateRange", direction: "both" } } },
];

function TypedColumns() {
  return <DataGrid columns={COLUMNS} data={LEAGUES} emptyMessage="No sport leagues match." getRowId={(league) => league.id} />;
}

const meta = {
  title: "Tables/DataGridDateFilter",
  component: TypedColumns,
} satisfies Meta<typeof TypedColumns>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Every column type's filter. Last run is a past date and time (its quick list looks back),
 * Starts a calendar date written as numbers, and Season a date range matched by Overlaps,
 * Starts within or Ends within. Members filters by From and To, Active by Yes and No, Sport
 * league by Contains or Starts with. Dates are padded so the rows line up.
 */
export const TypedColumnFilters: Story = {};
