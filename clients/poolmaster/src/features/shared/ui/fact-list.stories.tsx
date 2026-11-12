import type { Meta, StoryObj } from "@storybook/react-vite";
import { FactList } from "./fact-list";

const meta = {
  title: "Content/FactList",
  component: FactList,
  args: {
    facts: [
      { id: "status", label: "Entry status", value: "Submitted" },
      { id: "phase", label: "Contest phase", value: "Open until the first tee time" },
      { id: "created", label: "Created", value: "Apr 7, 2026, 9:14 AM" },
    ],
  },
} satisfies Meta<typeof FactList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Label left, value right, hairlines between: the default for labels beside values. */
export const Inline: Story = {};

/** In a popover or a peek card. */
export const Compact: Story = { args: { density: "compact" } };

/** Under a leaderboard row that opened it: a pick's breakdown. */
export const Inset: Story = {
  args: {
    layout: "inset",
    density: "compact",
    facts: [
      { id: "g1", label: "Game 1", value: "28 pts · 9 reb · 6 ast" },
      { id: "g2", label: "Game 2", value: "31 pts · 7 reb · 8 ast" },
    ],
  },
};

/** Side by side, small-caps labels over values; the columns stack on a phone. */
export const Columns: Story = {
  args: {
    layout: "columns",
    facts: [
      { id: "plan", label: "Plan", value: "Pro" },
      { id: "leagues", label: "Sports leagues in 2026", value: "2 of 3", detail: "PGA Tour, NFL" },
      { id: "entries", label: "Biggest open contest", value: "38 of 50 entries", detail: "Masters Tiers Pool" },
    ],
  },
};
