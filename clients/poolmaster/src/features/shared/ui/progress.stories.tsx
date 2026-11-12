import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressIndicator } from "./progress";

const meta = {
  title: "Feedback/ProgressIndicator",
  component: ProgressIndicator,
  args: { label: "Entries submitted", max: 24, value: 17 },
} satisfies Meta<typeof ProgressIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Danger: Story = { args: { tone: "danger", label: "Storage used", max: 100, value: 92 } };
