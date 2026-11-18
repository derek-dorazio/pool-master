import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { DataGrid } from "./data-grid";
import { optionsFromLabels } from "./data-grid-filters";

type Member = { id: string; name: string; role: string; entries: number };

const MEMBERS: Member[] = Array.from({ length: 32 }, (_, index) => ({
  id: String(index + 1),
  name: ["Sam Rivera", "Alex Chen", "Jordan Lee", "Casey Park"][index % 4] + ` ${index + 1}`,
  role: index === 0 ? "Owner" : "Member",
  entries: (index * 7) % 5,
}));

const COLUMNS: ColumnDef<Member>[] = [
  { accessorKey: "name", header: "Name", meta: { type: { kind: "text" } } },
  { accessorKey: "role", header: "Role", meta: { type: { kind: "text" } } },
  { accessorKey: "entries", header: "Entries", meta: { type: { kind: "number" } } },
];

function MembersGrid(props: { pageSize?: number; showColumnFilters?: boolean; withSearch?: boolean }) {
  const { withSearch = true, ...rest } = props;
  return (
    <DataGrid
      columns={COLUMNS}
      data={MEMBERS}
      emptyMessage="No members match."
      getRowId={(member) => member.id}
      {...(withSearch ? { search: { label: "Search members" } } : {})}
      {...rest}
    />
  );
}

const meta = {
  title: "Tables/DataGrid",
  component: MembersGrid,
  args: { pageSize: 10 },
} satisfies Meta<typeof MembersGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A table that needs search, sorting or paging. A list that can grow pages and searches. */
export const SearchAndPages: Story = {};
export const ColumnFilters: Story = { args: { showColumnFilters: true, withSearch: false } };

function MembersWithViews() {
  const [view, setView] = useState("all");
  const owners = MEMBERS.filter((member) => member.role === "Owner");
  return (
    <DataGrid
      columns={COLUMNS}
      data={view === "owners" ? owners : MEMBERS}
      emptyMessage="No members match."
      getRowId={(member) => member.id}
      pageSize={10}
      search={{ label: "Find a member" }}
      showColumnFilters={false}
      views={{
        label: "Members to show",
        onChange: setView,
        options: [
          { count: MEMBERS.length, label: "All", value: "all" },
          { count: owners.length, label: "Owners", value: "owners" },
        ],
        value: view,
      }}
    />
  );
}

/** A manage list: the views at the left of the card's header, the search at its right. */
export const ViewsAndSearch: StoryObj = { render: () => <MembersWithViews /> };

type SportEvent = { id: string; name: string; stage: string; issues: string[]; field?: number };

const EVENT_STATUS = { DRAFT: "Draft", SCHEDULED: "Scheduled", IN_PROGRESS: "In progress", COMPLETED: "Completed", CANCELLED: "Cancelled" };
const ISSUES = { SYNC: "Sync", RELEASE: "Release", LINKING: "Linking", OVERDUE: "Overdue" };

const EVENTS: SportEvent[] = [
  { id: "1", name: "Arnold Palmer Invitational", stage: "DRAFT", issues: ["LINKING"], field: 72 },
  { id: "2", name: "Genesis Invitational", stage: "SCHEDULED", issues: [], field: 70 },
  { id: "3", name: "Phoenix Open", stage: "SCHEDULED", issues: ["SYNC", "RELEASE"], field: 132 },
  { id: "4", name: "Pebble Beach Pro-Am", stage: "DRAFT", issues: [] },
  { id: "5", name: "The American Express", stage: "COMPLETED", issues: ["OVERDUE"], field: 156 },
  { id: "6", name: "The Sentry", stage: "CANCELLED", issues: [], field: 59 },
];

const EVENT_COLUMNS: ColumnDef<SportEvent>[] = [
  { accessorKey: "name", header: "Name", meta: { type: { kind: "text" } } },
  {
    accessorKey: "stage",
    header: "Status",
    meta: { type: { kind: "enum", values: optionsFromLabels(EVENT_STATUS), initial: ["DRAFT", "SCHEDULED"] } },
    cell: ({ getValue }) => EVENT_STATUS[getValue<keyof typeof EVENT_STATUS>()],
  },
  {
    accessorKey: "issues",
    header: "Issues",
    enableSorting: false,
    meta: { type: { kind: "enum", values: optionsFromLabels(ISSUES), manyPerCell: true } },
    cell: ({ getValue }) => getValue<string[]>().map((issue) => ISSUES[issue as keyof typeof ISSUES]).join(", ") || "—",
  },
  { accessorKey: "field", header: "Field", meta: { type: { kind: "number" } } },
];

/**
 * Sort and filter from the header: ⇅ sorts (blanks last), the funnel opens the column's filter
 * over the rows. Status is an enum column that starts on Draft and Scheduled; Issues holds several
 * values per cell, so its filter offers Match any or Match all.
 */
export const HeaderFilters: StoryObj = {
  render: () => <DataGrid columns={EVENT_COLUMNS} data={EVENTS} emptyMessage="No events match." getRowId={(event) => event.id} />,
};
