import type { Meta, StoryObj } from "@storybook/react-vite";
import { HelpTip } from "./help-tip";
import { Text } from "./text";

const meta = {
  title: "More info/HelpTip",
  component: HelpTip,
  args: {
    children: "Each golfer's score counts toward your total. Your best four of six count.",
    label: "How scoring works",
    testId: "story-help",
  },
  decorators: [(Story) => <span className="inline-flex items-center gap-1"><Text variant="strong">Scoring</Text><Story /></span>],
} satisfies Meta<typeof HelpTip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** (?) How it works: one to three sentences. Hover on a desktop, tap on a phone. */
export const HowItWorks: Story = {};
/** With its one learn-more link. */
export const WithLearnMore: Story = { args: { learnMore: { label: "How to Play", to: "/how-to-play" } } };
