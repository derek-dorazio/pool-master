import type { Meta, StoryObj } from "@storybook/react-vite";
import { SplitContentLayout } from "./layout-presets";
import { Text } from "./text";
import { Tile } from "./tile";

const meta = {
  title: "Page/SplitContentLayout",
  component: SplitContentLayout,
  args: {
    main: <Tile><Text>Main column</Text></Tile>,
    aside: <Tile variant="subtle"><Text>Side column</Text></Tile>,
  },
} satisfies Meta<typeof SplitContentLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two columns on a desktop, stacked on a phone. */
export const Default: Story = {};
