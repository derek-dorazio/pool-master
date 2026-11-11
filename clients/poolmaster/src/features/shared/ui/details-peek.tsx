import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { DETAILS_PEEK_HOVER_DELAY_MS } from "./popover-timing";
import { InfoPopover } from "./info-popover";
import { SectionFooterLink } from "./section-card";

/**
 * Details (#1585 pattern 2): "who or what is this?" answered in place. An (i) after the name of
 * one thing on screen (an entry, an event, a golfer, a team) opens a light peek card about it.
 * A mouse resting on the icon opens it after a short delay, so scanning down a list does not
 * flash every row; keyboard and tap open it too. Its content mounts only when it opens, so a
 * peek that reads data reads it then; `onHoverStart` lets it start that read as the mouse
 * arrives, before the delay ends.
 */
export function DetailsPeek({
  children,
  className,
  icon,
  label,
  onHoverStart,
  testId,
}: {
  /** The peek card, usually a `PeekCard`, or a component that reads its data and draws one. */
  children: ReactNode;
  className?: string;
  /** What the button shows instead of the (i), such as an entry's status glyph. */
  icon?: ReactNode;
  /** The button's accessible name: what the peek is about, such as "About Incubus 1". */
  label: string;
  onHoverStart?: () => void;
  testId: string;
}) {
  return (
    <InfoPopover
      className={className}
      hoverDelayMs={DETAILS_PEEK_HOVER_DELAY_MS}
      icon={icon ?? <Info aria-hidden className="text-muted-foreground" size={16} />}
      label={label}
      onHoverStart={onHoverStart}
      padding="none"
      testId={testId}
    >
      {children}
    </InfoPopover>
  );
}

export type PeekFact = { label: string; value: ReactNode };

/**
 * A peek card: the thing's name, a short subtitle, two to four label and value facts, and an
 * optional link on to its full page. Each fact's label must be unique within the card.
 */
export function PeekCard({
  facts,
  link,
  subtitle,
  testId,
  title,
}: {
  facts: readonly PeekFact[];
  link?: { label: string; testId: string; to: string };
  subtitle?: ReactNode;
  testId?: string;
  title: ReactNode;
}) {
  return (
    <div className="text-sm" data-testid={testId}>
      <div className="grid gap-0.5 border-b border-border px-4 py-3">
        <span className="font-display text-base font-bold text-foreground">{title}</span>
        {subtitle ? <span className="text-muted-foreground">{subtitle}</span> : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-3">
        {facts.map((fact) => (
          <div className="contents" key={fact.label}>
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="m-0 font-semibold text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {link ? <SectionFooterLink label={link.label} testId={link.testId} to={link.to} /> : null}
    </div>
  );
}
