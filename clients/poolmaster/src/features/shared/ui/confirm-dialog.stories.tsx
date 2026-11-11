import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConfirmDialog } from "./confirm-dialog";

const meta = {
  title: "Dialogs/ConfirmDialog",
  component: ConfirmDialog,
  args: {
    confirmLabel: "Remove",
    description: "Sam Rivera loses access to this league. Their entries stay on the leaderboards.",
    onCancel: () => undefined,
    onConfirm: () => undefined,
    onOpenChange: () => undefined,
    open: true,
    title: "Remove Sam Rivera?",
    tone: "danger",
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Danger: Story = {};
export const Default: Story = { args: { tone: "default", confirmLabel: "Release", title: "Release the field?", description: "Members can start making picks." } };
export const Pending: Story = { args: { isPending: true, pendingLabel: "Removing" } };
