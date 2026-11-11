import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pager } from "./pager";

const meta = {
  title: "Navigation/Pager",
  component: Pager,
  args: { onNext: () => undefined, onPrevious: () => undefined, pageCount: 4, pageIndex: 1, pageSize: 25, total: 87 },
} satisfies Meta<typeof Pager>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MiddlePage: Story = {};
export const FirstPage: Story = { args: { pageIndex: 0 } };
