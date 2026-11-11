import type { Meta, StoryObj } from "@storybook/react-vite";
import { Heading } from "./heading";

const meta = {
  title: "Content/Heading",
  component: Heading,
  args: { level: 2, children: "Masters Tournament", variant: "section" },
} satisfies Meta<typeof Heading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Section: Story = {};

/** `level` is the tag; `variant` is the look. */
export const Variants: Story = {
  render: () => (
    <div className="grid gap-3">
      <Heading level={1} variant="hero">Hero</Heading>
      <Heading level={1} variant="display">Display</Heading>
      <Heading level={1} variant="pageTitle">Page title</Heading>
      <Heading level={2} variant="section">Section</Heading>
      <Heading level={3} variant="subtitle">Subtitle</Heading>
      <Heading level={3} variant="label">Label</Heading>
      <Heading level={3} variant="eyebrow">Eyebrow</Heading>
      <Heading level={3} size="lg" variant="card">Card</Heading>
    </div>
  ),
};
