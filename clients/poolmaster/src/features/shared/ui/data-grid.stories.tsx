import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { DataGrid } from "./data-grid";
import { optionsFromLabels } from "../../../test/data-grid-options";

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

function MembersGrid(props: { showColumnFilters?: boolean; withSearch?: boolean }) {
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
} satisfies Meta<typeof MembersGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A table that needs search or sorting. Every row shows; the search and filters narrow them. */
export const Search: Story = {};
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

const EXPLAINED_COLUMNS: ColumnDef<Member>[] = [
  { accessorKey: "name", header: "Name", meta: { info: "The member's display name in the league.", type: { kind: "text" } } },
  { accessorKey: "role", header: "Role", meta: { info: "Owners run the league; members play in it.", type: { kind: "text" } } },
  { accessorKey: "entries", header: "Entries", meta: { type: { kind: "number" } } },
];

/**
 * A column that explains itself shows an (i) after its name. A row that leads to a page ends in
 * a ›; a row that opens a dialog ends in a ⤢ button. The whole row is still the click target.
 */
export const ColumnInfoAndRowIcons: StoryObj = {
  render: () => (
    <div className="space-y-6">
      <DataGrid
        columns={EXPLAINED_COLUMNS}
        data={MEMBERS.slice(0, 4)}
        emptyMessage="No members match."
        getRowId={(member) => member.id}
        getRowLink={(member) => `/members/${member.id}`}
      />
      <DataGrid
        columns={EXPLAINED_COLUMNS}
        data={MEMBERS.slice(4, 8)}
        emptyMessage="No members match."
        getRowId={(member) => member.id}
        openRowDialog={() => undefined}
      />
    </div>
  ),
};

type QueuedJob = { id: string; what: string; queuedAt: string };

const HOUR_MS = 60 * 60_000;
const QUEUED_JOBS: QueuedJob[] = [
  { id: "1", what: "Live scores", queuedAt: new Date(Date.now() - HOUR_MS).toISOString() },
  { id: "2", what: "Fields", queuedAt: new Date(Date.now() - 6 * HOUR_MS).toISOString() },
  { id: "3", what: "Event list", queuedAt: new Date(Date.now() - 3 * 24 * HOUR_MS).toISOString() },
];

const QUEUED_JOB_COLUMNS: ColumnDef<QueuedJob>[] = [
  {
    accessorKey: "queuedAt",
    header: "Started",
    meta: { type: { kind: "datetime", direction: "past", initial: { kind: "relative", toward: "past", amount: 1, unit: "d" } } },
  },
  { accessorKey: "what", header: "What", meta: { type: { kind: "text" } } },
];

/**
 * A date column can open on a span, as Activity's Started opens on the past day: the job queued
 * three days ago shows once the filter is cleared. A Past span reaches up to now, so a row that
 * arrives later still shows.
 */
export const DateColumnOpensOnSpan: StoryObj = {
  render: () => <DataGrid columns={QUEUED_JOB_COLUMNS} data={QUEUED_JOBS} emptyMessage="No jobs match." getRowId={(job) => job.id} />,
};
