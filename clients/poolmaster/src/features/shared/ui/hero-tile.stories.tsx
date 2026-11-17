import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Eyebrow } from "./eyebrow";
import { HeroTile } from "./hero-tile";
import { Text } from "./text";

const meta = {
  title: "Content/HeroTile",
  component: HeroTile,
  args: {
    actions: <Button size="sm">Make your picks</Button>,
    children: <Text tone="onInverseMuted">Entries close Apr 10, 2026, 8:00 AM</Text>,
    edge: "open",
    eyebrow: <Eyebrow tone="inverse">Open for entries · Tiered</Eyebrow>,
    testId: "hero",
    title: "NBA Finals Stars",
    to: "/",
  },
} satisfies Meta<typeof HeroTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const Live: Story = {
  args: {
    actions: <Button size="sm">Leaderboard</Button>,
    children: <Text tone="onInverseMuted">{"You're 3rd of 14"}</Text>,
    edge: "live",
    eyebrow: <Eyebrow tone="inverse">Live · 2 of 5 games played</Eyebrow>,
    title: "Week 12 Pick'em",
  },
};
export const Highlighted: Story = { args: { isHighlighted: true } };
