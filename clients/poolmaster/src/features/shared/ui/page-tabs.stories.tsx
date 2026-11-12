import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageTabs } from "./page-tabs";
import { Tabs, TabsContent } from "./tabs";
import { Text } from "./text";

const meta = {
  title: "Navigation/PageTabs",
  component: PageTabs,
  args: {
    "aria-label": "League views",
    variant: "link",
    items: [
      { isActive: true, label: "Home", to: "/" },
      { isActive: false, label: "Contests", to: "/contests", count: 4 },
      { isActive: false, label: "My team", to: "/team" },
      { isActive: false, label: "Championships", to: "/championships" },
      { isActive: false, label: "Members", to: "/members", count: 24 },
    ],
  },
} satisfies Meta<typeof PageTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Views with their own address. On a phone the row scrolls and keeps the open tab in view. */
export const Links: Story = {};

/** Views held in the page's state, inside the page's own `Tabs` root. */
export const State: StoryObj = {
  render: () => (
    <Tabs defaultValue="current">
      <PageTabs
        aria-label="Contest views"
        items={[
          { label: "Current", value: "current", count: 2 },
          { label: "Past", value: "past" },
        ]}
        variant="state"
      />
      <TabsContent value="current"><Text>Current contests go here.</Text></TabsContent>
      <TabsContent value="past"><Text>Past contests go here.</Text></TabsContent>
    </Tabs>
  ),
};
