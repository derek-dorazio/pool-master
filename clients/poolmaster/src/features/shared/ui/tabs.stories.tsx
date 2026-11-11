import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SegmentedControl, Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Text } from "./text";

const meta = {
  title: "Navigation/Tabs",
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In-card tabs. A page's own views use `PageTabs`. */
export const Default: Story = {
  render: () => (
    <Tabs defaultValue="entries">
      <TabsList>
        <TabsTrigger value="entries">Entries</TabsTrigger>
        <TabsTrigger value="picks">Picks</TabsTrigger>
      </TabsList>
      <TabsContent value="entries"><Text>Entries</Text></TabsContent>
      <TabsContent value="picks"><Text>Picks</Text></TabsContent>
    </Tabs>
  ),
};

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
