import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SegmentedControl, Tabs } from "./tabs";

const meta = {
  title: "Navigation/Tabs",
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;

function SegmentedDemo() {
  const [value, setValue] = useState("week");
  return (
    <SegmentedControl
      aria-label="Range"
      onChange={setValue}
      options={[
        { label: "This week", value: "week" },
        { label: "Season", value: "season" },
        { disabled: true, label: "All time", value: "all" },
      ]}
      value={value}
    />
  );
}

export const Segmented: StoryObj = { render: () => <SegmentedDemo /> };
