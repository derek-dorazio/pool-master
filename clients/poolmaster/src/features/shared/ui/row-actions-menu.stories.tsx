import type { Meta, StoryObj } from "@storybook/react-vite";
import { RowActionsMenu } from "./row-actions-menu";

const meta = {
  title: "Navigation/RowActionsMenu",
  component: RowActionsMenu,
  args: {
    actions: [
      { label: "Open to league", onSelect: () => undefined },
      { label: "Delete", onSelect: () => undefined, tone: "danger" },
    ],
    label: "Actions for Masters Pool",
  },
} satisfies Meta<typeof RowActionsMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The "⋯" at a list row's end, holding the row's quick actions. */
export const Default: Story = {};
