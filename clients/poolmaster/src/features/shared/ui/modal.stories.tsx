import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Modal } from "./modal";
import { Text } from "./text";

const meta = {
  title: "Dialogs/Modal",
  component: Modal,
  args: {
    children: <Text as="p">Move this entry to another team?</Text>,
    footer: <Button>Done</Button>,
    onOpenChange: () => undefined,
    open: true,
    title: "Entry actions",
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Only for a dialog that is neither a form nor a confirmation (#1599 adds a lint check). */
export const Default: Story = {};
