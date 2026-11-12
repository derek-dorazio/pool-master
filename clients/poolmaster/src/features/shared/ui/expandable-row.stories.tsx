import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExpandableRow } from "./expandable-row";
import { Text } from "./text";

const meta = {
  title: "More info/ExpandableRow",
  component: ExpandableRow,
  args: {
    label: "Picks for Weekend Warriors 2",
    summary: <Text variant="strong">Weekend Warriors 2</Text>,
    testId: "story-row",
    children: <div className="px-4 py-3"><Text as="p" variant="meta">Scheffler -8 · McIlroy -5 · Åberg -3</Text></div>,
  },
} satisfies Meta<typeof ExpandableRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Show me the breakdown: opens on a click or tap, never on hover. */
export const Row: Story = {};
/** The shaded bar that heads a leaderboard entry, shown open. */
export const Bar: Story = { args: { defaultOpen: true, look: "bar" } };
