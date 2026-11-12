import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import { SectionCard } from "./section-card";
import { Text } from "./text";

type LockedSectionProps = {
  /** One line on what unlocks it, such as "Included with Premium." Never how the feature works. */
  children: ReactNode;
  /** Where the plans are compared; the footer link goes there. */
  plansTo: string;
  /** The footer link's words. */
  plansLabel?: string;
  testId: string;
  /** The same title the section has when the plan includes it, so it stays in its place. */
  title: ReactNode;
};

/**
 * A section the plan doesn't include (`rules/ux-rules.md` §12): still titled and in its usual
 * place, so a commissioner sees what the plan leaves out, with a lock, one line saying which plan
 * includes it, and a "See plans" footer link. Never a dead section or a missing one.
 */
export function LockedSection({ children, plansLabel = "See plans", plansTo, testId, title }: LockedSectionProps) {
  return (
    <SectionCard footer={{ label: plansLabel, testId: `${testId}-plans`, to: plansTo }} testId={testId} title={title}>
      <div className="flex items-center gap-3 px-4 py-3.5" data-testid={`${testId}-locked`}>
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border">
          <Icon icon={Lock} size={14} tone="default" />
        </span>
        <Text as="p" tone="muted" variant="body">{children}</Text>
      </div>
    </SectionCard>
  );
}
