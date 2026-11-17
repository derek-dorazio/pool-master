import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatStrip } from "./stat-strip";

const meta = {
  title: "Content/StatStrip",
  component: StatStrip,
  args: {
    items: [
      { label: "Picked", value: "9 of 14" },
      { label: "Points", value: "0" },
      { label: "Max", value: "14" },
    ],
  },
} satisfies Meta<typeof StatStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PickEm: Story = {};
export const Survivor: Story = { args: { items: [{ label: "Your pick", value: "KC" }, { label: "Status", value: "In" }] } };
export const Squares: Story = { args: { items: [{ label: "Your boxes", value: "5 of 10" }, { label: "Numbers", value: "After the board fills" }] } };
