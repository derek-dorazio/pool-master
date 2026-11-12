import type { Meta, StoryObj } from "@storybook/react-vite";
import { DefinitionList, MetricGrid, MetricTile } from "./metric-grid";

const meta = {
  title: "Content/MetricGrid",
  component: MetricGrid,
  args: {
    children: (
      <>
        <MetricTile label="Members" value="24" />
        <MetricTile helperText="2 live" label="Contests" value="5" />
        <MetricTile label="Championships" value="3" />
      </>
    ),
  },
} satisfies Meta<typeof MetricGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Being replaced by FactList (#1589). */
export const RetiringDefinitionList: StoryObj = {
  render: () => (
    <DefinitionList
      items={[
        { id: "sport", label: "Sport", value: "Golf" },
        { id: "format", label: "Format", value: "Tiered picks" },
      ]}
    />
  ),
};
