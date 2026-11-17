import { useEffect, useId, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "./class-names";
import { Heading } from "./heading";
import { Tile } from "./tile";

/**
 * A hero (#1763): the navy panel League Home leads with, one per contest that matters now. Its
 * top edge says what kind it is (red for live, gold for open), a link over the whole tile opens
 * `to` beneath its buttons, so a button is never inside a link, and the buttons sit on their own
 * row at the bottom. Highlighted, it takes a ring and scrolls into view.
 */
export function HeroTile({
  actions,
  children,
  edge,
  eyebrow,
  isHighlighted = false,
  testId,
  title,
  to,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  edge: "live" | "open";
  /** The line over the title. */
  eyebrow: ReactNode;
  isHighlighted?: boolean;
  testId: string;
  title: string;
  to: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (isHighlighted) {
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [isHighlighted]);

  return (
    <Tile
      aria-labelledby={titleId}
      as="section"
      className={cn("relative flex flex-col gap-3", isHighlighted ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : undefined)}
      data-highlighted={isHighlighted || undefined}
      data-testid={testId}
      edge={edge}
      radius="panel"
      ref={ref}
      variant="inverse"
    >
      <Link
        aria-labelledby={titleId}
        className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={`${testId}-link`}
        to={to}
      />
      {eyebrow}
      <Heading data-testid={`${testId}-name`} id={titleId} level={2} size="xl" tone="inherit" variant="card">{title}</Heading>
      {children}
      {actions ? <div className="relative mt-auto flex flex-wrap items-center gap-3" data-testid={`${testId}-actions`}>{actions}</div> : null}
    </Tile>
  );
}
