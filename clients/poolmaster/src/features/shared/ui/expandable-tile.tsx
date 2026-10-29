import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./class-names";
import { Tile } from "./tile";

/**
 * A tile whose face is one button that opens it: open, it spans the whole grid row, takes the
 * primary border and shows its details under a rule. The caller owns which tile is open.
 */
export function ExpandableTile({
  children,
  face,
  isOpen,
  onToggle,
  testId,
}: {
  /** The details, shown only while open. */
  children: ReactNode;
  /** What the closed tile shows: its picture, name and line. */
  face: ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <Tile
      className={cn("flex flex-col gap-3", isOpen ? "col-span-full border-primary" : null)}
      data-testid={testId}
      padding="none"
      radius="md"
    >
      <Button
        aria-expanded={isOpen}
        className="normal-case tracking-normal h-auto flex-col items-stretch gap-2 rounded-2xl p-2 text-left font-normal"
        data-testid={`${testId}-toggle`}
        onClick={onToggle}
        size="auto"
        variant="ghost"
      >
        {face}
      </Button>
      {isOpen ? (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 text-sm" data-testid={`${testId}-details`}>
          {children}
        </div>
      ) : null}
    </Tile>
  );
}
