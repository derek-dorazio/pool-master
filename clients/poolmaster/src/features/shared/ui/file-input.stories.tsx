import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileInput } from "./file-input";

const meta = {
  title: "Forms/FileInput",
  component: FileInput,
  args: { "aria-label": "Upload a field file", accept: ".csv" },
} satisfies Meta<typeof FileInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
