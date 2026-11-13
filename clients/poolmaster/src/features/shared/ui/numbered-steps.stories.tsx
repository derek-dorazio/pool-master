import type { Meta, StoryObj } from "@storybook/react-vite";
import { NumberedSteps } from "./numbered-steps";

const meta = {
  title: "Content/NumberedSteps",
  component: NumberedSteps,
  args: {
    steps: [
      { title: "Create a league", body: "Name it and pick a sport." },
      { title: "Invite friends", body: "Share the league's web address." },
      { title: "Start a contest", body: "Members make picks before it starts." },
    ],
  },
} satisfies Meta<typeof NumberedSteps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Titles only, set tighter: three steps beside the sign-in form, or under it on a phone. */
export const CompactTitlesOnly: Story = {
  args: {
    className: "grid-cols-3 gap-3",
    density: "compact",
    steps: [{ title: "Create a league" }, { title: "Invite friends" }, { title: "Start a contest" }],
  },
};
