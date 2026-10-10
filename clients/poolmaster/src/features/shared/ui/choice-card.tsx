import type { ReactNode } from "react";
import { cn } from "./class-names";

/**
 * One choice drawn as a card, for a radio group whose options need more than a label: a radio
 * mark, then whatever the option shows. Put the cards in an element with `role="radiogroup"`.
 */
export function ChoiceCard({
  children,
  isSelected,
  onSelect,
  testId,
}: {
  children: ReactNode;
  isSelected: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      aria-checked={isSelected}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
        isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
      )}
      data-testid={testId}
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <span
        aria-hidden
        className={cn(
          "grid h-4 w-4 flex-none place-items-center rounded-full border-2",
          isSelected ? "border-primary" : "border-border",
        )}
      >
        {isSelected ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
      </span>
      {children}
    </button>
  );
}
