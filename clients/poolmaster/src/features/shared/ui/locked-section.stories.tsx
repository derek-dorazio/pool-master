import type { Meta, StoryObj } from "@storybook/react-vite";
import { LockedSection } from "./locked-section";

const meta = {
  title: "Sections/LockedSection",
  component: LockedSection,
  args: {
    children: "Included with Premium.",
    plansTo: "/league/BIGDAWGS/admin/plan",
    testId: "story-locked",
    title: "Event emails",
  },
} satisfies Meta<typeof LockedSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A feature the league's plan leaves out: titled, in its place, with a lock and "See plans". */
export const Default: Story = {};
