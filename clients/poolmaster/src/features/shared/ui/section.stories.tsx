import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { SectionHeader } from "./section";

const meta = {
  title: "Retiring/SectionHeader",
  component: SectionHeader,
  args: { title: "Invitations", actions: <Button size="sm">Invite</Button> },
} satisfies Meta<typeof SectionHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
