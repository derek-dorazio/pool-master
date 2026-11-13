import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./class-names";
import { Tile } from "./tile";

/**
 * A tile whose face is one button that opens it: open, it spans the whole grid row, takes the
 * primary border and shows its details under a rule. The caller owns which tile is open.
 * `actions` sit on their own row at the closed tile's bottom right, beside the face's button
 * rather than inside it, so each is a control of its own (#1701: a commissioner's "+ Create").
 */
export function ExpandableTile({
  actions,
  children,
  face,
  id,
  isOpen,
  onToggle,
  testId,
}: {
  /** The closed tile's own actions, such as one small button; none while open. */
  actions?: ReactNode;
  /** The details, shown only while open. */
  children: ReactNode;
  /** What the closed tile shows: its picture, name and line. */
  face: ReactNode;
  /** The tile's anchor, for a page that scrolls to it. */
  id?: string;
  isOpen: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <Tile
      className={cn("flex flex-col gap-3", isOpen ? "col-span-full border-primary" : null)}
      data-testid={testId}
      id={id}
      padding="none"
      radius="md"
    >
      <Button
        aria-expanded={isOpen}
        className="flex-col items-stretch gap-2 rounded-2xl p-2 font-normal"
        data-testid={`${testId}-toggle`}
        layout="row"
        onClick={onToggle}
        size="auto"
        variant="ghost"
      >
        {face}
      </Button>
      {actions && !isOpen ? (
        <div className="-mt-2 flex justify-end px-2 pb-2" data-testid={`${testId}-actions`}>{actions}</div>
      ) : null}
      {isOpen ? (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 text-sm" data-testid={`${testId}-details`}>
          {children}
        </div>
      ) : null}
    </Tile>
  );
}
