import type { Meta, StoryObj } from "@storybook/react-vite";
import { FaqList } from "./faq-list";

const meta = {
  title: "Content/FaqList",
  component: FaqList,
  args: {
    items: [
      { question: "Can I change my picks?", answer: "Yes, until the first tee time." },
      { question: "What happens in a tie?", answer: "Tied entries share the place." },
    ],
  },
} satisfies Meta<typeof FaqList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
