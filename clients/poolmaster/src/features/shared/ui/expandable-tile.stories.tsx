import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ExpandableTile } from "./expandable-tile";
import { Text } from "./text";

function ExpandableDemo({ startOpen }: { startOpen: boolean }) {
  const [isOpen, setIsOpen] = useState(startOpen);
  return (
    <ExpandableTile face={<Text variant="strong">Tiered picks</Text>} isOpen={isOpen} onToggle={() => setIsOpen(!isOpen)} testId="story-tile">
      <Text as="p">Pick one golfer from each of six tiers. Your best four scores count.</Text>
    </ExpandableTile>
  );
}

const meta = {
  title: "More info/ExpandableTile",
  component: ExpandableDemo,
  args: { startOpen: false },
} satisfies Meta<typeof ExpandableDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
export const Open: Story = { args: { startOpen: true } };
