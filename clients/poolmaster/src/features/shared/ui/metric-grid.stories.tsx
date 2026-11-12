import type { Meta, StoryObj } from "@storybook/react-vite";
import { MetricGrid, MetricTile } from "./metric-grid";

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
