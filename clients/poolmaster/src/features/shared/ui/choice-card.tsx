import type { ReactNode } from "react";
import { cn } from "./class-names";
import { Text } from "./text";

/**
 * One choice drawn as a card, for a radio group whose options need more than a label: a radio
 * mark, then whatever the option shows. Put the cards in an element with `role="radiogroup"`.
 * A disabled card stays visible so its children can say why it cannot be chosen.
 */
export function ChoiceCard({
  children,
  isDisabled = false,
  isSelected,
  onSelect,
  testId,
}: {
  children: ReactNode;
  isDisabled?: boolean;
  isSelected: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      aria-checked={isSelected}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
        isSelected ? "border-primary bg-primary/5" : "border-border",
        isDisabled ? "cursor-not-allowed opacity-60" : !isSelected && "hover:border-primary/50",
      )}
      data-testid={testId}
      disabled={isDisabled}
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

/**
 * A choice card's usual content: its name in bold over a one-line description. The name may
 * carry an icon before it.
 */
export function ChoiceCardText({ description, label }: { description: ReactNode; label: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <Text as="span" className="flex items-center gap-2" size="inherit" tone="inherit" weight="semibold">{label}</Text>
      <Text as="span" className="block" variant="caption">{description}</Text>
    </span>
  );
}
