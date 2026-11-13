import type { Meta, StoryObj } from "@storybook/react-vite";
import { StepStrip } from "./step-strip";

const meta = {
  title: "Content/StepStrip",
  component: StepStrip,
  args: {
    steps: [
      { title: "Start a league", picture: <div className="aspect-[16/10] w-full bg-muted" /> },
      { title: "Pick a contest", picture: <div className="aspect-[16/10] w-full bg-muted" /> },
      { title: "Follow it live", picture: <div className="aspect-[16/10] w-full bg-muted" /> },
    ],
  },
} satisfies Meta<typeof StepStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three across from the small breakpoint, stacked on a phone. */
export const Default: Story = {};

/** Without pictures: the numeral and title alone. */
export const TitlesOnly: Story = {
  args: { steps: [{ title: "Start a league" }, { title: "Pick a contest" }, { title: "Follow it live" }] },
};
