import type { Meta, StoryObj } from "@storybook/react-vite";
import { SeedChip } from "./seed-chip";

const meta = {
  title: "Content/SeedChip",
  component: SeedChip,
  args: { seed: 1 },
} satisfies Meta<typeof SeedChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A one-digit seed, the square's narrowest. */
export const OneDigit: Story = {};
/** A two-digit seed widens the square rather than shrinking the digits. */
export const TwoDigits: Story = { args: { seed: 16 } };
