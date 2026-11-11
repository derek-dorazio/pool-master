import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyButton } from "./copy-button";

const meta = {
  title: "Content/CopyButton",
  component: CopyButton,
  args: { label: "Copy link", text: "https://example.com/join/WW2026" },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Says Copied, or shows an inline error when the browser refuses. */
export const Default: Story = {};
export const IconOnly: Story = { args: { iconOnly: true } };
