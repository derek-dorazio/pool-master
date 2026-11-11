import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleHelp } from "lucide-react";
import { Icon } from "./icon";
import { InfoPopover } from "./info-popover";
import { Text } from "./text";

const meta = {
  title: "More info/InfoPopover",
  component: InfoPopover,
  args: {
    children: <Text as="p">Each golfer&apos;s score counts toward your total. Your best four of six count.</Text>,
    icon: <Icon aria-hidden icon={CircleHelp} size={16} tone="muted" />,
    label: "How scoring works",
    testId: "story-info",
  },
} satisfies Meta<typeof InfoPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The base of HelpTip (?) and DetailsPeek (i): opens on click or tap. */
export const HowItWorks: Story = {};
