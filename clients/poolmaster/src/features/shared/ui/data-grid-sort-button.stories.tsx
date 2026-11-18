import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SortDirection } from "@tanstack/react-table";
import { useState } from "react";
import { DataGridSortButton } from "./data-grid-sort-button";

const NEXT: Record<string, false | SortDirection> = { false: "asc", asc: "desc", desc: false };

function SortableHeader() {
  const [direction, setDirection] = useState<false | SortDirection>(false);
  return (
    <div className="group/header inline-flex text-xs uppercase text-muted-foreground">
      <DataGridSortButton direction={direction} onClick={() => setDirection(NEXT[String(direction)])} testId="story-sort" tone="plain">
        Starts
      </DataGridSortButton>
    </div>
  );
}

const meta = {
  title: "Tables/DataGridSortButton",
  component: SortableHeader,
} satisfies Meta<typeof SortableHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A `DataGrid` column's name as its sort button: click for ascending, descending, then off. */
export const Cycle: Story = {};
