import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "./button";
import { FormField, Input } from "./form-field";
import { AsyncPage, DataGridPage, EntityDetailPage, FormEditorSection, PublicInviteJoinPage } from "./page-templates";
import { Text } from "./text";

const meta = {
  title: "Page/AsyncPage",
  component: AsyncPage,
  args: { children: <Text>Page content</Text>, header: { title: "Members" } },
} satisfies Meta<typeof AsyncPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const Loading: Story = { args: { state: "loading" } };
export const Failed: Story = { args: { state: "error", error: new Error("The server did not answer.") } };
export const Empty: Story = { args: { state: "empty", emptyTitle: "No members yet" } };

type Row = { id: string; name: string };
const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: "name", header: "Name" }];

/** Being retired with ManagementListPage: a SectionCard with rows instead (#1611). */
export const RetiringDataGridPage: StoryObj = {
  render: () => (
    <DataGridPage<Row>
      columns={COLUMNS}
      data={[{ id: "1", name: "Sam Rivera" }, { id: "2", name: "Alex Chen" }]}
      emptyMessage="No members."
      header={{ title: "Members" }}
    />
  ),
};

/** Being retired (#1562). */
export const RetiringEntityDetailPage: StoryObj = {
  render: () => (
    <EntityDetailPage
      actions={<Button variant="secondary">Reset password</Button>}
      details={<Text>Sam Rivera · sam@example.com</Text>}
      header={{ title: "Sam Rivera" }}
    />
  ),
};

export const EditorSection: StoryObj = {
  render: () => (
    <FormEditorSection footer={<Button>Save</Button>} title="Scoring">
      <FormField label="Scores that count"><Input defaultValue="4" /></FormField>
    </FormEditorSection>
  ),
};

export const InviteJoin: StoryObj = {
  render: () => (
    <PublicInviteJoinPage
      context={<Text variant="meta">Sam Rivera invited you</Text>}
      primaryAction={<Button>Join league</Button>}
      secondaryAction={<Button variant="ghost">Not now</Button>}
      title="Join Weekend Warriors"
    >
      <Text>24 members · Golf</Text>
    </PublicInviteJoinPage>
  ),
};
