import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "./text";
import { Tile } from "./tile";

const meta = {
  title: "Content/Tile",
  component: Tile,
  args: { children: <Text>A bordered box.</Text> },
} satisfies Meta<typeof Tile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Subtle: Story = { args: { variant: "subtle" } };
export const Inverse: Story = { args: { variant: "inverse" } };
export const InverseDeep: Story = { args: { variant: "inverseDeep" } };
export const SmallPadding: Story = { args: { padding: "sm", radius: "md" } };
