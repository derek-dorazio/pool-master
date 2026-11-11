import type { Meta, StoryObj } from "@storybook/react-vite";
import { DialogActions } from "./dialog-actions";

const meta = {
  title: "Dialogs/DialogActions",
  component: DialogActions,
  args: { actionLabel: "Save", cancelLabel: "Cancel", isPending: false, onAction: () => undefined, onCancel: () => undefined },
  decorators: [(Story) => <div className="flex justify-end gap-2"><Story /></div>],
} satisfies Meta<typeof DialogActions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The one dialog footer that `ConfirmDialog` and `FormModal` share. */
export const Default: Story = {};
export const Danger: Story = { args: { actionLabel: "Delete", tone: "danger" } };
export const Pending: Story = { args: { isPending: true, pendingLabel: "Saving" } };
