import type { Meta, StoryObj } from "@storybook/react-vite";
import { BulkUploadPanel } from "./bulk-upload-panel";
import { Text } from "./text";

type Row = { name: string };

function Panel() {
  return (
    <BulkUploadPanel<Row, Row>
      apply={() => Promise.resolve()}
      applyError={null}
      isApplyPending={false}
      isPreviewPending={false}
      parse={(text) => text.split("\n").filter(Boolean).map((name) => ({ name }))}
      preview={(rows) => Promise.resolve(rows)}
      previewError={null}
      renderPreview={(rows) => <Text>{rows.length} rows ready</Text>}
      templateFilename="field.csv"
      templateHeaders={["name"]}
      templateSampleRow={["Scottie Scheffler"]}
      testId="story-bulk"
      unresolvedCount={() => 0}
    />
  );
}

const meta = {
  title: "Tables/BulkUploadPanel",
  component: Panel,
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Download a template, upload a filled one, check the preview, then apply. */
export const Default: Story = {};
