import type { Meta, StoryObj } from "@storybook/react-vite";
import { YearPicker } from "./year-picker";

const meta = {
  title: "Forms/YearPicker",
  component: YearPicker,
  args: { onChange: () => undefined, value: 2026, years: [2026, 2025, 2024, 2023] },
} satisfies Meta<typeof YearPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The one "Season" picker, used in a header's `tabsEnd`. */
export const Default: Story = {};
