import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckList } from "./check-list";
import { Tile } from "./tile";

const meta = {
  title: "Content/CheckList",
  component: CheckList,
  args: {
    items: [
      { id: "event", isMet: true, label: "Event chosen" },
      { id: "field", isMet: true, label: "Field released" },
      { id: "tiers", isMet: false, label: "Tiers set" },
      { id: "close", isMet: true, label: "Entries close in the future" },
    ],
  },
} satisfies Meta<typeof CheckList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On a normal card: missing first at full contrast, done dimmed behind a filled check. */
export const Default: Story = {};

/** On a navy panel, such as the contest's status card. */
export const Inverse: Story = {
  args: { surface: "inverse" },
  render: (args) => (
    <Tile padding="md" variant="inverse">
      <CheckList {...args} />
    </Tile>
  ),
};
