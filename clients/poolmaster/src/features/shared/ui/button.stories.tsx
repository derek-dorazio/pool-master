import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, LinkButton } from "./button";

const meta = {
  title: "Primitives/Button",
  component: Button,
  args: { children: "Save changes" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap gap-3">
      <Button {...args} variant="primary">Primary</Button>
      <Button {...args} variant="secondary">Secondary</Button>
      <Button {...args} variant="subtle">Subtle</Button>
      <Button {...args} variant="ghost">Ghost</Button>
      <Button {...args} variant="danger">Delete</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} size="xs">XS</Button>
      <Button {...args} size="sm">Small</Button>
      <Button {...args} size="md">Medium</Button>
      <Button {...args} size="lg">Large</Button>
    </div>
  ),
};

export const Busy: Story = { args: { isLoading: true, children: "Saving" } };

export const Disabled: Story = { args: { disabled: true } };

/** A line of content that acts, such as a list row or a pick: sentence case, full width. */
export const RowLayout: Story = {
  args: { layout: "row", variant: "secondary", children: "Masters Tournament · Augusta National" },
};

export const AsLink: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <LinkButton to="/plans">See plans</LinkButton>
      <LinkButton to="/plans" variant="secondary">Compare plans</LinkButton>
      <LinkButton to="/plans" variant="secondary" isDisabled>Unavailable</LinkButton>
    </div>
  ),
};
