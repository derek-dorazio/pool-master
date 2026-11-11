import type { Meta, StoryObj } from "@storybook/react-vite";
import { GripVertical } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { SortableList } from "./sortable-list";
import { Text } from "./text";
import { Tile } from "./tile";

function SortableDemo() {
  const [items, setItems] = useState([
    { id: "a", name: "Tier 1" },
    { id: "b", name: "Tier 2" },
    { id: "c", name: "Tier 3" },
  ]);
  return (
    <SortableList
      aria-label="Tiers"
      className="grid gap-2"
      items={items}
      onReorder={(ids) => setItems(ids.flatMap((id) => items.filter((item) => item.id === id)))}
      renderItem={(item, { dragHandleProps }) => (
        // The row is the caller's content; a tier list draws it as a small Tile.
        <Tile className="flex items-center gap-2" padding="sm" radius="md">
          <Button aria-label={`Move ${item.name}`} {...dragHandleProps} size="xs" variant="ghost"><GripVertical aria-hidden size={16} /></Button>
          <Text>{item.name}</Text>
        </Tile>
      )}
    />
  );
}

const meta = {
  title: "Content/SortableList",
  component: SortableDemo,
} satisfies Meta<typeof SortableDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
