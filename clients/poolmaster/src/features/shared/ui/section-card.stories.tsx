import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import {
  SectionBody,
  SectionCard,
  SectionEmpty,
  SectionFooterLink,
  SectionNote,
  SectionRow,
  SectionRows,
  SectionTitle,
} from "./section-card";
import { StatusBadge } from "./status-badge";
import { Text } from "./text";

const meta = {
  title: "Sections/SectionCard",
  component: SectionCard,
  args: { title: "Up next", children: null },
} satisfies Meta<typeof SectionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Titled card with rows and a footer link for navigation: the approved section pattern. */
export const WithRows: Story = {
  args: {
    title: "Contests",
    help: "Every contest open in this league, soonest first.",
    footer: { label: "All contests", testId: "story-footer", to: "/contests" },
    children: (
      <SectionRows>
        <SectionRow aside={<StatusBadge tone="live">Live</StatusBadge>} facts="Golf · 42 entries" name="Masters Tournament" to="/c/1" value="3rd" />
        <SectionRow facts="Football · 18 entries" isHighlighted name="Week 11 Pick'em" to="/c/2" value="1st" />
        <SectionRow facts="Opens Friday" name="Super Bowl Squares" note="Picks close at kickoff" to="/c/3" />
      </SectionRows>
    ),
  },
};

export const Empty: Story = {
  args: { title: "Contests", children: <SectionEmpty>No contests yet.</SectionEmpty> },
};

export const WithBodyAndTrailing: Story = {
  args: {
    title: "League web address",
    trailing: <Button size="sm" variant="secondary">Edit</Button>,
    children: (
      <SectionBody>
        <Text>Share this address with members so they can join.</Text>
        <SectionNote>Anyone with the address can ask to join.</SectionNote>
      </SectionBody>
    ),
  },
};

export const DangerTone: Story = {
  args: {
    title: "Delete league",
    tone: "danger",
    children: <SectionBody><Button variant="danger">Delete league</Button></SectionBody>,
  },
};

export const TitleAndFooterLinkAlone: StoryObj = {
  render: () => (
    <div className="grid gap-4">
      <SectionTitle help="How standings are worked out." title="Standings" />
      <SectionFooterLink label="See all" testId="story-link" to="/all" />
    </div>
  ),
};
