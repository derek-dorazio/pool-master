export type FaqItem = { question: string; answer: string };

/** Questions in one ruled box, each opening to its answer. */
export function FaqList({ items, testId }: { items: readonly FaqItem[]; testId?: string }) {
  return (
    <div className="divide-y divide-border rounded-2xl border border-border bg-card" data-testid={testId}>
      {items.map((item) => (
        <details className="p-4" key={item.question}>
          <summary className="cursor-pointer font-semibold text-foreground">{item.question}</summary>
          <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
