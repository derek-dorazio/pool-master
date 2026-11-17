import type { ReactNode } from "react";
import { Text } from "./text";

export type StatStripItem = {
  label: string;
  value: ReactNode;
  /** The value's test id; the label and value together take `<testId>-item`. */
  testId?: string;
};

/**
 * A pick screen's progress in one line (#1769): the two or three numbers that matter, each a
 * small label before its value, with no helper text. It wraps between items on a narrow phone,
 * never inside one.
 */
export function StatStrip({ items, testId }: { items: readonly StatStripItem[]; testId?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg border border-border bg-card px-4 py-2" data-testid={testId}>
      {items.map((item) => (
        <span className="inline-flex items-baseline gap-2 whitespace-nowrap" data-testid={item.testId ? `${item.testId}-item` : undefined} key={item.label}>
          <Text variant="label">{item.label}</Text>
          <Text data-testid={item.testId} variant="value">{item.value}</Text>
        </span>
      ))}
    </div>
  );
}
