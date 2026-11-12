import type { Meta, StoryObj } from "@storybook/react-vite";
import { WebAddressBox } from "./web-address-box";

const meta = {
  title: "Content/WebAddressBox",
  component: WebAddressBox,
  args: { url: "https://primetimecommissioner.com/league/bigdawgs", isLive: true },
} satisfies Meta<typeof WebAddressBox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A live address, as League settings shows it: opens in a new tab. */
export const Live: Story = {};
/** While Create league is open: looks like a link, doesn't open yet, still copies. */
export const NotYetLive: Story = { args: { isLive: false, notLiveHint: "Opens once the league is created" } };
