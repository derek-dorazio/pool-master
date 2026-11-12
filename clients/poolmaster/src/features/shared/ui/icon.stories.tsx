import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleAlert, Trophy } from "lucide-react";
import { Icon } from "./icon";
import { Text } from "./text";

const meta = {
  title: "Content/Icon",
  component: Icon,
  args: { icon: Trophy, size: 20 },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  render: (args) => (
    <div className="flex gap-4">
      <Icon {...args} tone="default" />
      <Icon {...args} tone="muted" />
      <Icon {...args} tone="primary" />
      <Icon {...args} icon={CircleAlert} tone="danger" />
    </div>
  ),
};

/** `inline` sits an icon in a line of text. */
export const Inline: Story = {
  render: (args) => <Text as="p"><Icon {...args} inline size={16} />Champion 2025</Text>,
};
