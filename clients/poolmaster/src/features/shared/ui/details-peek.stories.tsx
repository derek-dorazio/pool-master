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
