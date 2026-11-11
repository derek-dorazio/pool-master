import type { Meta, StoryObj } from "@storybook/react-vite";
import { DateDisplay, DateTimeField } from "./date-time";

const meta = {
  title: "Content/DateDisplay",
  component: DateDisplay,
  args: { value: "2026-04-09T11:30:00Z" },
} satisfies Meta<typeof DateDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In the viewer's locale and time zone, with the zone named. */
export const DateAndTime: Story = {};
export const DateOnly: Story = { args: { timeStyle: null } };
export const Missing: Story = { args: { value: null } };
export const Field: StoryObj = { render: () => <DateTimeField aria-label="Picks close" /> };
