import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Notice } from "./notice";

const meta = {
  title: "More info/Notice",
  component: Notice,
  args: { title: "Picks close at 7:00 AM ET", children: "Make your picks before the first tee time." },
} satisfies Meta<typeof Notice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Notice (!) pattern: what the reader must know now, always visible. */
export const Info: Story = {};
export const Warning: Story = { args: { tone: "warning" } };
export const Danger: Story = { args: { tone: "danger", title: "We couldn't save your picks" } };
/** Being retired (#1599): a save closes its dialog and shows a toast instead. */
export const Success: Story = { args: { tone: "success", title: "Saved" } };
export const WithAction: Story = { args: { action: <Button size="sm" variant="secondary">Make picks</Button> } };
