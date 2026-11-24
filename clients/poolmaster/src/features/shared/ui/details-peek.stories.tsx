import type { Meta, StoryObj } from "@storybook/react-vite";
import { DetailsPeek, PeekCard } from "./details-peek";
import { LoadingState } from "./state";
import { Text } from "./text";

const meta = {
  title: "More info/DetailsPeek",
  component: DetailsPeek,
  args: {
    label: "About Weekend Warriors 2",
    testId: "story-peek",
    children: (
      <PeekCard
        facts={[
          { label: "Team", value: "Weekend Warriors" },
          { label: "Owners", value: "Sam Rivera, Alex Chen" },
        ]}
        link={{ label: "Team page", testId: "story-peek-link", to: "/team" }}
        subtitle="Entry 2 of 3"
        title="Weekend Warriors 2"
      />
    ),
  },
  decorators: [(Story) => <span className="inline-flex items-center gap-2"><Text variant="strong">Weekend Warriors 2</Text><Story /></span>],
} satisfies Meta<typeof DetailsPeek>;

export default meta;
type Story = StoryObj<typeof meta>;

/** (i) About a thing: an entry, event or team. Hover on a desktop, tap on a phone. */
export const Entry: Story = {};
export const Loading: Story = { args: { children: <LoadingState body="Loading team..." size="inline" /> } };

/** A value that opens (#1747): a team's wins on a leaderboard, the games it played in the card. */
export const OnAValue: Story = {
  args: {
    children: (
      <PeekCard
        facts={[
          { label: "First Round", value: "beat Miami 4-1" },
          { label: "Conference Semifinals", value: "beat Indiana 4-2" },
        ]}
        title="Boston Celtics"
      />
    ),
    icon: "2",
    label: "Wins for Boston Celtics",
    trigger: "text",
  },
};

/** A board cell that opens (#1758): a squares box's initials, its holder's full name in the card. */
export const OnACell: Story = {
  args: {
    children: <PeekCard facts={[{ label: "Numbers", value: "Chiefs 7 · Eagles 3" }, { label: "Won", value: "Q1" }]} title="Big Hitters" />,
    className: "flex size-8 rounded-sm border border-border bg-card text-xs font-semibold",
    icon: <span className="flex size-full items-center justify-center">BH</span>,
    label: "Row 1, column 1: Big Hitters",
    trigger: "cell",
  },
};
