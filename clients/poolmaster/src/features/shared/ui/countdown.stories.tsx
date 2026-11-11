import type { Meta, StoryObj } from "@storybook/react-vite";
import { Countdown } from "./countdown";

const meta = {
  title: "Content/Countdown",
  component: Countdown,
  args: { label: "Picks close in", now: new Date("2026-04-07T12:00:00Z"), until: "2026-04-09T11:30:00Z" },
} satisfies Meta<typeof Countdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Inverse: Story = {
  args: { tone: "inverse" },
  decorators: [(Story) => <div className="bg-surface-inverse p-4"><Story /></div>],
};
