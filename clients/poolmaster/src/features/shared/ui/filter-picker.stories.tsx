import type { Meta, StoryObj } from "@storybook/react-vite";
import { FilterPicker } from "./filter-picker";

const meta = {
  title: "Forms/FilterPicker",
  component: FilterPicker,
  args: {
    label: "Sport",
    onChange: () => undefined,
    options: [
      { label: "All sports", value: "" },
      { label: "Golf", options: [{ label: "All golf", value: "golf" }, { label: "PGA TOUR", value: "golf/pga-tour" }] },
      { label: "Soccer", options: [{ label: "All soccer", value: "soccer" }, { label: "Premier League", value: "soccer/premier-league" }] },
    ],
    value: "",
  },
} satisfies Meta<typeof FilterPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page filter with grouped choices, used in a header's `tabsEnd`. */
export const Grouped: Story = {};

/** A flat list of choices, as the Season picker uses. */
export const Flat: Story = {
  args: { label: "Season", options: [{ label: "2026", value: "2026" }, { label: "2025", value: "2025" }], value: "2026" },
};
