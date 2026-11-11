import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronRight, UserPlus } from "lucide-react";
import { ActionList, ActionTile } from "./action-list";

const meta = {
  title: "Retiring/ActionTile",
  component: ActionList,
  args: { children: null },
} satisfies Meta<typeof ActionList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Being retired: rows open their item and carry a "⋯" menu instead (#1611). */
export const Default: Story = {
  args: {
    children: (
      <>
        <ActionTile icon={<UserPlus aria-hidden size={18} />} label="Invite members" to="/invite" trailing={<ChevronRight aria-hidden size={16} />} />
        <ActionTile label="Release the field" tone="primary" />
        <ActionTile label="Delete contest" tone="danger" />
      </>
    ),
  },
};
