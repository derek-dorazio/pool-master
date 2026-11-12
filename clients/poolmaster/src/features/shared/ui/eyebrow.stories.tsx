import type { Meta, StoryObj } from "@storybook/react-vite";
import { Eyebrow } from "./eyebrow";

const meta = {
  title: "Content/Eyebrow",
  component: Eyebrow,
  args: { children: "This weekend" },
} satisfies Meta<typeof Eyebrow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Accent: Story = {};
export const Muted: Story = { args: { tone: "muted" } };
export const Inverse: Story = {
  args: { tone: "inverse" },
  decorators: [(Story) => <div className="bg-surface-inverse p-4"><Story /></div>],
};
