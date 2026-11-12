import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeagueMenu } from "./nav-menus";

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
