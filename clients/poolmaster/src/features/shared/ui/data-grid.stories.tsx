import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "./data-grid";

type Member = { id: string; name: string; role: string; entries: number };

const MEMBERS: Member[] = Array.from({ length: 32 }, (_, index) => ({
  id: String(index + 1),
  name: ["Sam Rivera", "Alex Chen", "Jordan Lee", "Casey Park"][index % 4] + ` ${index + 1}`,
  role: index === 0 ? "Owner" : "Member",
  entries: (index * 7) % 5,
}));

const COLUMNS: ColumnDef<Member>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "role", header: "Role" },
  { accessorKey: "entries", header: "Entries" },
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
