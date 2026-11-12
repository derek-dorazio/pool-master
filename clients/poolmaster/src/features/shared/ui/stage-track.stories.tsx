import type { Meta, StoryObj } from "@storybook/react-vite";
import { StageTrack } from "./stage-track";
import { Tile } from "./tile";

const meta = {
  title: "Content/StageTrack",
  component: StageTrack,
  args: { currentIndex: 1, stages: ["Set up", "Open", "Live", "Final"], testId: "story-stage-track" },
} satisfies Meta<typeof StageTrack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnACard: Story = {
  render: (args) => (
    <Tile padding="md" radius="md">
      <StageTrack {...args} />
    </Tile>
  ),
};

export const OnANavyPanel: Story = {
  args: { currentIndex: 2, surface: "inverse" },
  render: (args) => (
    <Tile padding="md" radius="md" variant="inverse">
      <StageTrack {...args} />
    </Tile>
  ),
};

export const Final: Story = { args: { currentIndex: 3 } };
