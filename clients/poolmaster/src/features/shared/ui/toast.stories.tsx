import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toast, ToastProvider, ToastViewport } from "./toast";

const meta = {
  title: "Feedback/Toast",
  component: Toast,
  args: { open: true, title: "Picks saved", description: "You can change them until 7:00 AM ET." },
  decorators: [(Story) => <ToastProvider><Story /><ToastViewport /></ToastProvider>],
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A save closes its dialog and says so here: no green success boxes on the page. */
export const Success: Story = { args: { tone: "success" } };
export const Default: Story = {};
export const Danger: Story = { args: { tone: "danger", title: "We couldn't save your picks", description: undefined } };
