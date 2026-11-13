import type { ReactNode } from "react";
import { PageTabs } from "./page-tabs";
import { Tabs, TabsContent } from "./tabs";
import { Tile } from "./tile";

export type TabbedCardTab = {
  label: string;
  value: string;
  testId?: string;
  /** The view's body, drawn with the card's padding. */
  content: ReactNode;
};

/**
 * A card whose views switch by quiet underlined `PageTabs` along its top, such as Sign in /
 * Create account. Only the open view is drawn. `radius="panel"` is for a card that stands apart
 * from the page (`rules/ux-rules.md` names where), the default the one 8px content corner.
 */
export function TabbedCard({
  "aria-label": ariaLabel,
  onValueChange,
  radius = "sm",
  tabs,
  testId,
  value,
}: {
  "aria-label": string;
  onValueChange: (value: string) => void;
  radius?: "panel" | "sm";
  tabs: readonly TabbedCardTab[];
  testId?: string;
  value: string;
}) {
  return (
    <Tile data-testid={testId} padding="none" radius={radius}>
      <Tabs onValueChange={onValueChange} value={value}>
        <div className="border-b border-border px-4 sm:px-6">
          <PageTabs
            aria-label={ariaLabel}
            items={tabs.map(({ label, testId: tabTestId, value: tabValue }) => ({ label, testId: tabTestId, value: tabValue }))}
            variant="state"
          />
        </div>
        {tabs.map((tab) => (
          <TabsContent className="p-4 focus-visible:outline-none sm:p-6" key={tab.value} value={tab.value}>
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </Tile>
  );
}
