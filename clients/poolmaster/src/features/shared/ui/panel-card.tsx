import { useId, type ReactNode } from "react";
import { LinkButton } from "./button";
import { cn } from "./class-names";
import { Heading } from "./heading";

type PanelCardFooter = { label: string; testId: string; to: string };

/**
 * A titled card: its title in a ruled bar (with an optional slot on the right, such as a status
 * badge), its body, and an optional footer link under a rule. The body is unpadded, for a
 * `PanelList` of divided rows; `padded` gives prose or a grid the card's own padding.
 */
export function PanelCard({
  children,
  className,
  footer,
  headingLevel = 2,
  padded = false,
  testId,
  title,
  titleTestId,
  trailing,
}: {
  children: ReactNode;
  className?: string;
  footer?: PanelCardFooter;
  headingLevel?: 2 | 3;
  padded?: boolean;
  testId?: string;
  /** The card's name, which also names its section for screen readers. */
  title: ReactNode;
  titleTestId?: string;
  trailing?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <Heading className="flex items-center gap-2" data-testid={titleTestId} id={titleId} level={headingLevel} size="sm" variant="card">{title}</Heading>
        {trailing}
      </div>
      {padded ? <div className="space-y-3 p-4" data-testid={testId ? `${testId}-body` : undefined}>{children}</div> : children}
      {footer ? (
        <LinkButton
          className="rounded-none border-t border-border"
          data-testid={footer.testId}
          layout="row"
          size="sm"
          to={footer.to}
          variant="ghost"
        >
          {footer.label} →
        </LinkButton>
      ) : null}
    </section>
  );
}

/** A panel card's divided rows. */
export function PanelList({ children, testId }: { children: ReactNode; testId?: string }) {
  return <ul className="divide-y divide-border" data-testid={testId}>{children}</ul>;
}
