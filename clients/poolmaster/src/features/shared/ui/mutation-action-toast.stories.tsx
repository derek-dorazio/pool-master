import type { Meta, StoryObj } from "@storybook/react-vite";
import { MutationActionToast } from "./mutation-action-toast";

const meta = {
  title: "Feedback/MutationActionToast",
  component: MutationActionToast,
  args: { onDismiss: () => undefined, toast: { title: "Member removed", tone: "success" } },
} satisfies Meta<typeof MutationActionToast>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The toast `useMutationActionWorkflow` shows after an action. */
export const Default: Story = {};
