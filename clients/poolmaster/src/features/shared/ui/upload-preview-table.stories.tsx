import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "./status-badge";
import { UploadPreviewTable } from "./upload-preview-table";

type Row = { line: number; name: string; match: string | null };
const ROWS: Row[] = [
  { line: 2, name: "Scottie Scheffler", match: "Scottie Scheffler" },
  { line: 3, name: "R. McIlroy", match: "Rory McIlroy" },
  { line: 4, name: "Unknown Golfer", match: null },
];

function Preview() {
  return (
    <UploadPreviewTable
      describeRow={(row) => `Line ${row.line}`}
      match={(row) => row.match ?? "No match"}
      matchHeader="Matched golfer"
      resolution={(row) => (row.match ? <StatusBadge tone="active">Matched</StatusBadge> : <StatusBadge tone="warning">Unresolved</StatusBadge>)}
      rows={ROWS}
      testId="story-preview"
    />
  );
}

const meta = {
  title: "Tables/UploadPreviewTable",
  component: Preview,
} satisfies Meta<typeof Preview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
