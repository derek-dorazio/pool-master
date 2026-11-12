import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings } from "lucide-react";
import { AdminAreaLayout, LeagueMenu } from "./nav-menus";
import { Text } from "./text";

const meta = {
  title: "Navigation/LeagueMenu",
  component: LeagueMenu,
  args: {
    "aria-label": "League",
    items: [
      { isActive: true, label: "Home", testId: "home", to: "/" },
      { isActive: false, label: "Contests", testId: "contests", to: "/contests" },
      { isActive: false, label: "My team", testId: "team", to: "/team" },
      { isActive: false, label: "Members", testId: "members", to: "/members" },
    ],
  },
} satisfies Meta<typeof LeagueMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The root admin frame with its side menu; commissioner tools move to top PageTabs (#1562). */
export const AdminArea: StoryObj = {
  render: () => (
    <AdminAreaLayout
      back={{ label: "Back to league", testId: "back", to: "/" }}
      eyebrow="Commissioner"
      icon={<Settings aria-hidden size={20} />}
      menuItems={[
        { group: "League", isActive: true, label: "Settings", testId: "settings", to: "/admin" },
        { group: "League", isActive: false, label: "Members", testId: "members", to: "/admin/members" },
        { group: "Contests", isActive: false, label: "Contests", testId: "contests", to: "/admin/contests" },
      ]}
      menuLabel="Commissioner tools"
      title="Weekend Warriors"
    >
      <Text>Area content</Text>
    </AdminAreaLayout>
  ),
};
