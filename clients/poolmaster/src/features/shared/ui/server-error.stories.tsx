import type { Meta, StoryObj } from "@storybook/react-vite";
import { ServerErrorBar } from "./server-error";

const meta = {
  title: "Feedback/ServerErrorBar",
  component: ServerErrorBar,
  args: { error: new Error("The server did not answer."), onRetry: () => undefined },
} satisfies Meta<typeof ServerErrorBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRetry: Story = {};
export const Titled: Story = { args: { title: "We couldn't load members" } };
