import type { Meta, StoryObj } from "@storybook/react-vite";
import { Flag } from "lucide-react";
import { IconAvatar } from "./icon-avatar";

const meta = {
  title: "Content/IconAvatar",
  component: IconAvatar,
  args: { children: <Flag aria-hidden size={20} />, label: "Golf" },
} satisfies Meta<typeof IconAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  render: (args) => (
    <div className="flex gap-3">
      <IconAvatar {...args} tone="default" />
      <IconAvatar {...args} tone="inverse" />
      <IconAvatar {...args} tone="muted" />
      <IconAvatar {...args} selected />
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <IconAvatar {...args} size="sm" />
      <IconAvatar {...args} size="md" />
      <IconAvatar {...args} size="lg" />
    </div>
  ),
};
