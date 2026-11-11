import type { Meta, StoryObj } from "@storybook/react-vite";
import { Alert } from "./alert";
import { Button } from "./button";

const meta = {
  title: "Feedback/Alert",
  component: Alert,
  args: { title: "Picks close at 7:00 AM ET", children: "Make your picks before the first tee time." },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Becomes the Notice (!) pattern (#1585): must-know, always visible. */
export const Info: Story = {};
export const Warning: Story = { args: { tone: "warning" } };
export const Danger: Story = { args: { tone: "danger", title: "We couldn't save your picks" } };
/** Being retired (#1599): a save closes its dialog and shows a toast instead. */
export const Success: Story = { args: { tone: "success", title: "Saved" } };
export const WithAction: Story = { args: { action: <Button size="sm" variant="secondary">Make picks</Button> } };
