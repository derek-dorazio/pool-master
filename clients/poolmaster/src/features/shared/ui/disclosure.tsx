import type { ReactNode } from "react";
import { cn } from "./class-names";

type DisclosureProps = {
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  summary: ReactNode;
};

export function Disclosure({
  children,
  className,
  defaultOpen = false,
  summary,
}: DisclosureProps) {
  return (
    <details
      className={cn(
        "rounded-[1.25rem] border border-border bg-card p-4",
        className,
      )}
      open={defaultOpen}
    >
      <summary className="cursor-pointer text-sm font-semibold text-foreground">
        {summary}
      </summary>
      <div className="mt-3 text-sm text-muted-foreground">{children}</div>
    </details>
  );
}

type AccordionItem = {
  content: ReactNode;
  defaultOpen?: boolean;
  id: string;
  summary: ReactNode;
};

type AccordionProps = {
  className?: string;
  items: AccordionItem[];
};

export function Accordion({ className, items }: AccordionProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {items.map((item) => (
        <Disclosure
          defaultOpen={item.defaultOpen}
          key={item.id}
          summary={item.summary}
        >
          {item.content}
        </Disclosure>
      ))}
    </div>
  );
}
