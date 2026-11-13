import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./button";
import { ExpandableTile } from "./expandable-tile";
import { Text } from "./text";

function ExpandableDemo({ startOpen, withAction = false }: { startOpen: boolean; withAction?: boolean }) {
  const [isOpen, setIsOpen] = useState(startOpen);
  return (
    <ExpandableTile actions={withAction ? <Button size="sm">+ Create</Button> : undefined} face={<Text variant="strong">Tiered picks</Text>} isOpen={isOpen} onToggle={() => setIsOpen(!isOpen)} testId="story-tile">
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
/** A closed tile with its own action on a row of its own, beside the face's button. */
export const WithAction: Story = { args: { startOpen: false, withAction: true } };
