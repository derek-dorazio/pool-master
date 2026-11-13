import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "./text";

const meta = {
  title: "Content/Text",
  component: Text,
  args: { children: "Scottie Scheffler" },
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Body: Story = {};

/** Every variant, in its default tone. Pages pick a variant, never a size or colour class. */
export const Variants: Story = {
  render: () => (
    <div className="grid gap-2">
      <Text as="p" variant="body">Body: running text, a sentence or a note.</Text>
      <Text as="p" variant="meta">Meta: Golf · 42 entries · Closes Thursday</Text>
      <Text as="p" variant="caption">Caption: updated 2 minutes ago</Text>
      <Text as="p" variant="label">Label: points</Text>
      <Text as="p" variant="value">Value: 1,284.5</Text>
      <Text as="p" variant="strong">Strong: Weekend Warriors 2</Text>
    </div>
  ),
};

export const Tones: Story = {
  render: () => (
    <div className="grid gap-2">
      <Text as="p" tone="default">Default</Text>
      <Text as="p" tone="muted">Muted</Text>
      <Text as="p" tone="danger">Danger</Text>
      <Text as="p" tone="primary">Primary</Text>
    </div>
  ),
};

/** A tile's line that must fit two lines two-across on a phone: small there, `sm` from the small breakpoint. */
export const PhoneTileLine: Story = {
  render: () => (
    <div className="w-44">
      <Text as="p" size="xsToSm" variant="meta">One pick per tier, from favorites to long shots.</Text>
    </div>
  ),
};
