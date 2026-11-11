import { Info } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "./class-names";
import { Heading } from "./heading";
import { InfoPopover } from "./info-popover";

/**
 * The one section look (#1561): a title bar with a rule, a body of rows, padded content or one
 * empty line, and an optional footer link. Every part owns its fonts and colours; callers pass
 * content only, and a new look becomes a variant here, never classes on a page.
 */

type SectionTone = "danger" | "default";

type SectionFooter = { label: string; testId: string; to: string };

/**
 * A section's title in the house uppercase italic, with an optional info icon that holds the
 * section's explanation (sentences never sit in the body) and an optional trailing slot for one
 * badge, count or filter.
 */
export function SectionTitle({
  id,
  info,
  level = 2,
  testId,
  title,
  tone = "default",
  trailing,
}: {
  id?: string;
  /** The explanation, shown when the info icon is hovered or tapped. */
  info?: ReactNode;
  level?: 2 | 3;
  testId?: string;
  title: ReactNode;
  tone?: SectionTone;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-2">
      <Heading
        className={cn("flex items-center gap-2", tone === "danger" ? "text-destructive" : undefined)}
        data-testid={testId}
        id={id}
        level={level}
        size="sm"
        tone={tone === "danger" ? "inherit" : "default"}
        variant="card"
      >
        {title}
      </Heading>
      {info ? (
        <InfoPopover
          className="-my-2 -ml-2"
          icon={<Info aria-hidden className="text-muted-foreground" size={16} />}
          label="About this section"
          testId={testId ? `${testId}-info` : "section-info"}
        >
          <p className="text-sm text-muted-foreground">{info}</p>
        </InfoPopover>
      ) : null}
      {trailing ? <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{trailing}</div> : null}
    </div>
  );
}

/**
 * A titled section: its title bar, its body and an optional footer link. The body is unpadded,
 * for `SectionRows` or a `SectionEmpty` line; `padded` gives other content the card's padding.
 * `bare` keeps the title and rule but drops the box, for long page content such as Owners;
 * `tone="danger"` is a danger zone.
 */
export function SectionCard({
  bare = false,
  children,
  className,
  footer,
  headingLevel = 2,
  info,
  padded = false,
  testId,
  title,
  titleTestId,
  tone = "default",
  trailing,
}: {
  bare?: boolean;
  children: ReactNode;
  className?: string;
  footer?: SectionFooter;
  headingLevel?: 2 | 3;
  info?: ReactNode;
  padded?: boolean;
  testId?: string;
  /** The section's name, which also names it for screen readers. */
  title: ReactNode;
  titleTestId?: string;
  tone?: SectionTone;
  trailing?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        bare ? "space-y-4" : "overflow-hidden rounded-lg border bg-card",
        !bare && (tone === "danger" ? "border-destructive/40" : "border-border"),
        className,
      )}
      data-testid={testId}
    >
      <div className={cn("border-b", tone === "danger" ? "border-destructive/40" : "border-border", bare ? "pb-1" : "px-4 py-1")}>
        <SectionTitle id={titleId} info={info} level={headingLevel} testId={titleTestId} title={title} tone={tone} trailing={trailing} />
      </div>
      {padded && !bare ? <SectionBody testId={testId ? `${testId}-body` : undefined}>{children}</SectionBody> : children}
      {footer ? <SectionFooterLink label={footer.label} testId={footer.testId} to={footer.to} /> : null}
    </section>
  );
}

/** A section's rows: divided, every other one lightly shaded. */
export function SectionRows({ children, testId }: { children: ReactNode; testId?: string }) {
  return <ul className="divide-y divide-border" data-testid={testId}>{children}</ul>;
}

/**
 * One row of a section: a name, up to two muted fact lines, and at the right one figure
 * (`value`) and one badge or action (`aside`). With `to` the whole row is a link. Rows tint on
 * hover; `isHighlighted` tints the row the viewer came from and scrolls it into view, and
 * `isSelected` tints the one a list has chosen (a year, say) and marks it current.
 */
export function SectionRow({
  aside,
  facts,
  isHighlighted = false,
  isSelected = false,
  name,
  nameAddon,
  note,
  testId,
  to,
  value,
  valueTestId,
}: {
  /** A status badge or one action, drawn as given. */
  aside?: ReactNode;
  /** The row's muted fact line. */
  facts?: ReactNode;
  isHighlighted?: boolean;
  isSelected?: boolean;
  name: ReactNode;
  /** A marker beside the name, such as You or Inactive. */
  nameAddon?: ReactNode;
  /** A second muted line. */
  note?: ReactNode;
  testId?: string;
  to?: string;
  /** The row's figure: a place, a total, a count. */
  value?: ReactNode;
  valueTestId?: string;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isHighlighted) {
      (linkRef.current ?? rowRef.current)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [isHighlighted]);

  const className = cn(
    "flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-row-hover",
    isHighlighted || isSelected ? "bg-primary/10" : undefined,
  );
  const ariaCurrent = isSelected ? "true" : undefined;
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-foreground">{name}</span>
          {nameAddon}
        </span>
        {facts ? <span className="block text-sm text-muted-foreground">{facts}</span> : null}
        {note ? <span className="block text-sm text-muted-foreground">{note}</span> : null}
      </span>
      {value || aside ? (
        <span className="flex flex-none items-center gap-2">
          {value ? <span className="font-semibold tabular-nums text-foreground" data-testid={valueTestId}>{value}</span> : null}
          {aside}
        </span>
      ) : null}
    </>
  );

  return (
    <li className="even:bg-row-alt">
      {to ? (
        <Link aria-current={ariaCurrent} className={className} data-highlighted={isHighlighted || undefined} data-testid={testId} ref={linkRef} to={to}>
          {content}
        </Link>
      ) : (
        <div aria-current={ariaCurrent} className={className} data-highlighted={isHighlighted || undefined} data-testid={testId} ref={rowRef}>
          {content}
        </div>
      )}
    </li>
  );
}

/**
 * A padded block inside a section card, for a grid, chart or form beside rows in the same card
 * (a `padded` card wraps its whole body in one).
 */
export function SectionBody({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div className="space-y-3 p-4" data-testid={testId}>{children}</div>;
}

/**
 * A line of words about the section's data inside a padded body, such as a standing or a
 * projection: muted by default, `tone="default"` for the one line the section leads with.
 */
export function SectionNote({ children, testId, tone = "muted" }: { children: ReactNode; testId?: string; tone?: "default" | "muted" }) {
  return <p className={cn("text-sm", tone === "default" ? "text-foreground" : "text-muted-foreground")} data-testid={testId}>{children}</p>;
}

/** A section with nothing to show: one short muted line in italics, so it never reads as data. */
export function SectionEmpty({ children, testId }: { children: ReactNode; testId?: string }) {
  return <p className="px-4 py-3.5 text-sm italic text-muted-foreground" data-testid={testId}>{children}</p>;
}

/**
 * Where a section leads: a right-aligned link in blue small caps with an arrow, in a ruled
 * footer, so it never reads as a row. Going to another page is always this, never a button.
 */
export function SectionFooterLink({ label, testId, to }: { label: string; testId: string; to: string }) {
  return (
    <div className="flex justify-end border-t border-border px-4 py-2.5">
      <Link
        className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-button text-label hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={testId}
        to={to}
      >
        {label}
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
