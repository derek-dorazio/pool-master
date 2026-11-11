import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { DetailsActionsLayout } from "./details-actions-layout";
import { Text } from "./text";

const meta = {
  title: "Retiring/DetailsActionsLayout",
  component: DetailsActionsLayout,
  args: {
    actions: <Button variant="secondary">Reset password</Button>,
    actionsTitle: "Actions",
    details: <Text>Sam Rivera · sam@example.com</Text>,
  },
} satisfies Meta<typeof DetailsActionsLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The layout under `EntityDetailPage`. */
export const Default: Story = {};
