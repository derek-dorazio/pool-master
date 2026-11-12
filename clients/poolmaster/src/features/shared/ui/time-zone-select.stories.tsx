import type { Meta, StoryObj } from "@storybook/react-vite";
import { TimeZoneSelect } from "./time-zone-select";

const meta = {
  title: "Forms/TimeZoneSelect",
  component: TimeZoneSelect,
  args: { "aria-label": "Time zone", value: "America/New_York" },
} satisfies Meta<typeof TimeZoneSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
