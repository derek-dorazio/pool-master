import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip, StatusBadge } from "./status-badge";

const meta = {
  title: "Content/StatusBadge",
  component: StatusBadge,
  args: { children: "Live" },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge tone="neutral">Draft</StatusBadge>
      <StatusBadge tone="info">Open</StatusBadge>
      <StatusBadge tone="active">Active</StatusBadge>
      <StatusBadge tone="live">Live</StatusBadge>
      <StatusBadge tone="locked">Locked</StatusBadge>
      <StatusBadge tone="final">Final</StatusBadge>
      <StatusBadge tone="completed">Completed</StatusBadge>
      <StatusBadge tone="success">Paid</StatusBadge>
      <StatusBadge tone="warning">Needs picks</StatusBadge>
      <StatusBadge tone="danger">Cancelled</StatusBadge>
      <StatusBadge tone="failed">Failed</StatusBadge>
      <StatusBadge tone="inactive">Inactive</StatusBadge>
      <StatusBadge tone="brandOutline">Game day</StatusBadge>
    </div>
  ),
};

/** Sentence-case pills: the gold brand pill, its tint and a not-yet placeholder. */
export const Chips: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Chip tone="brand">Champion</Chip>
      <Chip tone="brandTint">3 entries</Chip>
      <Chip tone="placeholder">Not picked</Chip>
    </div>
  ),
};
