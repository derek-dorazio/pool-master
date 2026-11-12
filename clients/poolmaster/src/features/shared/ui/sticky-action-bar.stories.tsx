import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { Button } from "./button";
import { StickyActionBar } from "./sticky-action-bar";
import { Text } from "./text";

function Page() {
  const watched = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-4">
      <Text as="p" variant="meta">On a phone width, scroll the watched block away to see the bar.</Text>
      <div className="h-[150vh]" />
      <div className="rounded-lg border border-border p-4" ref={watched}>The full block the bar stands in for</div>
      <StickyActionBar testId="sticky-bar" watch={watched}>
        <div className="flex items-center justify-between gap-3">
          <Text variant="meta">4 of 6 picked</Text>
          <Button size="sm">Submit entry</Button>
        </div>
      </StickyActionBar>
    </div>
  );
}

const meta = {
  title: "Layout/StickyActionBar",
  component: Page,
  parameters: { viewport: { defaultViewport: "mobile1" } },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The phone bar while its watched block is out of view. */
export const Default: Story = {};
