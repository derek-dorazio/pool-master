import { ExpandableRow } from "./expandable-row";
import { Text } from "./text";

export type FaqItem = { question: string; answer: string };

/**
 * Questions as section rows, each an `ExpandableRow` that opens to its answer (#1614). It draws
 * no frame of its own: it sits in a `SectionCard` titled "Questions", or in a `Tile` on a
 * landing page.
 */
export function FaqList({ items, testId }: { items: readonly FaqItem[]; testId?: string }) {
  return (
    <ul className="divide-y divide-border" data-testid={testId}>
      {items.map((item, index) => (
        <li key={item.question}>
          <ExpandableRow
            label={item.question}
            summary={<Text as="span" variant="strong" weight="semibold">{item.question}</Text>}
            testId={testId ? `${testId}-${index}` : undefined}
          >
            <Text as="p" className="px-4 py-3" variant="meta">{item.answer}</Text>
          </ExpandableRow>
        </li>
      ))}
    </ul>
  );
}
