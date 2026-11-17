import type { Meta, StoryObj } from "@storybook/react-vite";
import { TrophyMark } from "./trophy-mark";

const meta = {
  title: "Content/TrophyMark",
  component: TrophyMark,
} satisfies Meta<typeof TrophyMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Gold: the team it stands for can still win. */
export const StillIn: Story = {};
/** Grey: the team is out. */
export const Out: Story = { args: { isOut: true } };
/** Silver: a final contest's 2nd place. */
export const Silver: Story = { args: { metal: "silver" } };
/** Bronze: a final contest's 3rd place. */
export const Bronze: Story = { args: { metal: "bronze" } };
