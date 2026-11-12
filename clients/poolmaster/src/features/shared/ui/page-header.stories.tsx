import type { Meta, StoryObj } from "@storybook/react-vite";
import { Trophy } from "lucide-react";
import { Button } from "./button";
import { Input } from "./form-field";
import { PageHeader, Breadcrumbs } from "./page-header";
import { PageTabs } from "./page-tabs";
import { Chip, StatusBadge } from "./status-badge";
import { YearPicker } from "./year-picker";

const meta = {
  title: "Page/PageHeader",
  component: PageHeader,
  args: { title: "Contests" },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

const tabs = (
  <PageTabs
    aria-label="Contest views"
    items={[
      { isActive: true, label: "Current", to: "/contests", count: 3 },
      { isActive: false, label: "Past", to: "/contests/past" },
    ]}
    variant="link"
  />
);

/** Title, fact line and views: the shape almost every page uses. */
export const WithTabs: Story = {
  args: { meta: "Weekend Warriors · 3 active contests", tabs },
};

/** The status slot at the far right of the first line: Live, Final or a count. */
export const WithStatus: Story = {
  args: {
    breadcrumbs: [{ href: "/contests", label: "Contests" }, { label: "Masters Tournament" }],
    title: "Masters Tournament",
    meta: "Golf · Tiered picks · 42 entries",
    status: <StatusBadge tone="live">Live</StatusBadge>,
    tabs: (
      <PageTabs
        aria-label="Contest views"
        items={[
          { isActive: true, label: "Leaderboard", to: "/c/1" },
          { isActive: false, label: "My entries", to: "/c/1/entries", count: 2 },
          { isActive: false, label: "Rules", to: "/c/1/rules" },
        ]}
        variant="link"
      />
    ),
  },
};

export const WithIconAndActions: Story = {
  args: {
    title: "Championships",
    icon: <Trophy aria-hidden size={24} />,
    meta: "Every season's winners",
    actions: <Button size="sm" variant="secondary">Edit</Button>,
    status: <Chip tone="brandTint">3 seasons</Chip>,
    tabs,
    tabsEnd: <YearPicker onChange={() => undefined} value={2026} years={[2026, 2025, 2024]} />,
  },
};

/** The right slot as a search box instead of actions. */
export const WithSearch: Story = {
  args: {
    title: "Members",
    meta: "24 members",
    search: <Input aria-label="Search members" placeholder="Search members" />,
  },
};

export const BreadcrumbsOnly: StoryObj = {
  render: () => (
    <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: "/league", label: "Weekend Warriors" }, { label: "Settings" }]} />
  ),
};
