import type { Meta, StoryObj } from "@storybook/react-vite";
import { OneLineRow } from "./one-line-row";

const dots = (count: number) => Array.from({ length: count }, (_, index) => ({
  key: String(index),
  node: <span className="block h-5 w-5 rounded-full bg-muted" />,
}));

const meta = {
  title: "Content/OneLineRow",
  component: OneLineRow,
  args: { itemPx: 24, items: dots(11), label: "On eleven sports" },
  decorators: [(Story) => <div className="w-44 rounded-lg border border-border p-2"><Story /></div>],
} satisfies Meta<typeof OneLineRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Eleven icons in a phone tile's width: as many as fit, then "+N". */
export const Capped: Story = {};

/** A few icons: they all fit, with no "+N". */
export const AllFit: Story = { args: { items: dots(3), label: "On three sports" } };
