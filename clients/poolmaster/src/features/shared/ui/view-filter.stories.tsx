import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ViewFilter } from "./view-filter";

function InvitesViews() {
  const [value, setValue] = useState("pending");
  return (
    <ViewFilter
      aria-label="Invites to show"
      onChange={setValue}
      options={[
        { count: 4, label: "Pending", value: "pending" },
        { count: 1, label: "Expired", value: "expired" },
      ]}
      value={value}
    />
  );
}

const meta = {
  title: "Navigation/ViewFilter",
  component: InvitesViews,
} satisfies Meta<typeof InvitesViews>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Which rows a list shows, with a count each. In a `DataGrid` it sits in the card's header through `views`. */
export const WithCounts: Story = {};
