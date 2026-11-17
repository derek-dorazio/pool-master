import type { Meta, StoryObj } from "@storybook/react-vite";
import { WinnersBanner } from "./winners-banner";

const meta = {
  title: "Content/WinnersBanner",
  component: WinnersBanner,
  args: {
    runnersUp: [
      { label: "2nd", metal: "silver", names: ["Lakers 2"], score: "10 pts" },
      { label: "3rd", metal: "bronze", names: ["Sharks 1"], score: "9 pts" },
    ],
    testId: "winners",
    winner: { label: "Winner", metal: "gold", names: ["Big Hitters"], score: "11 pts" },
    yourFinish: "You finished 3rd of 14",
  },
} satisfies Meta<typeof WinnersBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** The viewer has several entries: every one, best first. */
export const SeveralEntries: Story = { args: { yourFinish: "You finished 3rd, 5th, and 11th of 14" } };
/** A tie for 1st names everyone tied, and leaves no 2nd. */
export const Tie: Story = {
  args: {
    runnersUp: [{ label: "3rd", metal: "bronze", names: ["Sharks 1"], score: "9 pts" }],
    winner: { label: "Tied for 1st", metal: "gold", names: ["Big Hitters", "Lakers 2"], score: "11 pts" },
    yourFinish: "You finished 5th of 14",
  },
};
/** The viewer did not enter. */
export const NotEntered: Story = { args: { yourFinish: null } };
