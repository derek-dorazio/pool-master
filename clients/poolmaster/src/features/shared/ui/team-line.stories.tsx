import type { Meta, StoryObj } from "@storybook/react-vite";
import { TeamLine } from "./team-line";

const meta = {
  title: "Content/TeamLine",
  component: TeamLine,
  args: { name: "Auburn", seed: 1 },
  decorators: [(Story) => <div className="w-44"><Story /></div>],
} satisfies Meta<typeof TeamLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A game not played yet: plain. */
export const NotPlayed: Story = {};
/** The pick was right. */
export const Right: Story = { args: { mark: "right" } };
/** The pick was wrong: struck through, with who really won in grey. */
export const Wrong: Story = { args: { name: "Michigan", seed: 5, mark: "wrong", actualName: "UC San Diego" } };
/** A later pick whose team is already out. */
export const AlreadyOut: Story = { args: { name: "Texas A&M", seed: 4, mark: "wrong" } };
/** Waiting for an earlier pick to fill it. */
export const Open: Story = { args: { name: "Round of 32 winner", isOpen: true } };
/** The entry's pick while picks can still change. */
export const Picked: Story = { args: { isPicked: true, onPick: () => undefined } };
/** The right half of a bracket: seed after the name. */
export const Mirrored: Story = { args: { isMirrored: true, mark: "right" } };
