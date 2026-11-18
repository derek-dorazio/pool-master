import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DataGridFilterPopup } from "./data-grid-filter-popup";
import { Input } from "./form-field";

function NamePopup() {
  const [open, setOpen] = useState(true);
  const [isFiltered, setIsFiltered] = useState(false);
  return (
    <div className="group/header inline-flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
      Name
      <DataGridFilterPopup
        canApply
        help="Type to match. Rows whose value contains it show, ignoring case."
        isFiltered={isFiltered}
        label="Name"
        onApply={() => { setIsFiltered(true); setOpen(false); }}
        onClear={() => { setIsFiltered(false); setOpen(false); }}
        onOpenChange={setOpen}
        open={open}
        testId="story-filter"
      >
        <Input aria-label="Name contains" placeholder="Contains" />
      </DataGridFilterPopup>
    </div>
  );
}

const meta = {
  title: "Tables/DataGridFilterPopup",
  component: NamePopup,
} satisfies Meta<typeof NamePopup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The popup every `DataGrid` column filter opens in: it floats over the rows, with Clear, Cancel and Apply. */
export const Open: Story = {};
