import type { ReactNode } from "react";
import { cn } from "./class-names";
import { Text } from "./text";

/** One label and its value. */
export type Fact = {
  id: string;
  label: ReactNode;
  value: ReactNode;
  /** A muted second line under the value, such as the names behind a count. */
  detail?: ReactNode;
  /** Set on the value (and its detail), which is what a test reads. */
  testId?: string;
};

/**
 * How the pairs sit:
 * - `inline`: one pair per line, the label left and the value right, hairlines between.
 * - `inset`: `inline`, indented under a row that opened it (a leaderboard pick's breakdown).
 * - `columns`: each label over its value, side by side; the columns stack on a phone.
 */
export type FactListLayout = "inline" | "inset" | "columns";
/** `compact` in a popover or a peek card, where the lines sit closer together. */
export type FactListDensity = "default" | "compact";

export type FactListProps = {
  facts: readonly Fact[];
  layout?: FactListLayout;
  density?: FactListDensity;
  /** How many columns the `columns` layout takes from a tablet up. */
  columns?: 2 | 3;
  /** Spacing around the list only, such as a top margin. */
  className?: string;
  id?: string;
  testId?: string;
};

const ROW_PADDING: Record<FactListDensity, string> = {
  default: "py-2",
  compact: "py-1",
};

const COLUMNS: Record<2 | 3, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
};

function FactValue({ fact, align }: { fact: Fact; align: "left" | "right" }) {
  return (
    <dd className={cn("m-0 min-w-0", align === "right" ? "text-right" : null)} data-testid={fact.testId}>
      <Text variant="value" weight="semibold">{fact.value}</Text>
      {fact.detail ? (
        <Text as="span" className="block" variant="meta">
          {fact.detail}
        </Text>
      ) : null}
    </dd>
  );
}

/**
 * Labels beside their values: an entry's status facts, a peek card's facts, a plan's usage, a
 * stat line's parts. Big-number tiles are a `MetricGrid`; rows with several columns of their
 * own are a `SimpleTable`. The list owns its type: labels are muted (small caps in `columns`),
 * values semibold with lined-up figures.
 */
export function FactList({
  className,
  columns = 3,
  density = "default",
  facts,
  id,
  layout = "inline",
  testId,
}: FactListProps) {
  if (layout === "columns") {
    return (
      <dl className={cn("m-0 grid gap-3", COLUMNS[columns], className)} data-testid={testId} id={id}>
        {facts.map((fact) => (
          <div className="grid min-w-0 content-start gap-0.5" key={fact.id}>
            <Text asChild variant="label">
              <dt>{fact.label}</dt>
            </Text>
            <FactValue align="left" fact={fact} />
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl
      className={cn("m-0 grid divide-y divide-border", layout === "inset" ? "pb-2 pl-14 pr-4" : null, className)}
      data-testid={testId}
      id={id}
    >
      {facts.map((fact) => (
        <div className={cn("flex items-baseline justify-between gap-4", ROW_PADDING[density])} key={fact.id}>
          <Text asChild className="min-w-0" variant="meta">
            <dt>{fact.label}</dt>
          </Text>
          <FactValue align="right" fact={fact} />
        </div>
      ))}
    </dl>
  );
}
