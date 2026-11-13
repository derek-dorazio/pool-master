import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChoiceChips } from "./choice-chips";

const SPORTS = [
  { isChosen: false, label: "All sports", to: "?" },
  { isChosen: false, label: "Football", to: "?sport=american-football" },
  { isChosen: false, label: "Basketball", to: "?sport=basketball" },
  { isChosen: true, label: "Hockey", to: "?sport=hockey" },
  { isChosen: false, label: "Soccer", to: "?sport=soccer" },
  { isChosen: false, label: "Golf", to: "?sport=golf" },
  { isChosen: false, label: "Racing", to: "?sport=auto-racing" },
];

const meta = {
  title: "Navigation/ChoiceChips",
  component: ChoiceChips,
  args: { "aria-label": "Sport", items: SPORTS },
} satisfies Meta<typeof ChoiceChips>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One line that scrolls sideways on a phone and keeps the chosen chip in view. */
export const Scrolling: Story = {};

/** A narrower choice in place of the one it narrows, with an × that clears it. */
export const Clearable: Story = {
  args: { clearable: { label: "NHL · Stanley Cup Final", replaces: "?sport=hockey" } },
};

/** Wrapping, for a list of every choice. */
export const Wrapping: Story = {
  args: {
    "aria-label": "Hockey leagues",
    layout: "wrap",
    items: [
      { isChosen: false, label: "NHL", to: "?sport=hockey&league=nhl" },
      { isChosen: false, label: "Stanley Cup Final", to: "?sport=hockey&league=nhl&part=stanley-cup-final" },
      { isChosen: false, label: "PWHL", to: "?sport=hockey&league=pwhl" },
      { isChosen: false, label: "NCAA Men's Hockey", to: "?sport=hockey&league=ncaa-division-i-men" },
      { isChosen: false, label: "Men's Frozen Four", to: "?sport=hockey&league=ncaa-division-i-men&part=men-s-frozen-four" },
    ],
  },
};
