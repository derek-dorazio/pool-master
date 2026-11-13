import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChoiceList } from "./choice-list";

const meta = {
  title: "Navigation/ChoiceList",
  component: ChoiceList,
  args: {
    "aria-label": "Sports and leagues",
    className: "w-52",
    items: [
      { isChosen: false, label: "All sports", to: "?", tone: "heading" },
      { count: 6, isChosen: false, label: "Football", to: "?sport=american-football", tone: "heading" },
      { count: 8, isChosen: false, label: "Hockey", to: "?sport=hockey", tone: "heading" },
      { depth: 1, isChosen: false, label: "NHL", to: "?sport=hockey&league=nhl" },
      { depth: 2, isChosen: false, label: "Regular season", to: "?sport=hockey&league=nhl&part=nhl" },
      { depth: 2, isChosen: true, label: "Stanley Cup Final", to: "?sport=hockey&league=nhl&part=stanley-cup-final" },
      { depth: 1, isChosen: false, label: "PWHL", to: "?sport=hockey&league=pwhl" },
      { depth: 1, isChosen: false, label: "+ 3 more", to: "?sport=hockey", tone: "muted" },
      { count: 14, isChosen: false, label: "Soccer", to: "?sport=soccer", tone: "heading" },
    ],
  },
} satisfies Meta<typeof ChoiceList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sports as headings with their counts, a sport's leagues under it and a league's rounds under that. */
export const Default: Story = {};
