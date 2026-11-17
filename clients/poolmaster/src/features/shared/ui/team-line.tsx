import { Check, X } from "lucide-react";
import { Button } from "./button";
import { cn } from "./class-names";
import { SeedChip } from "./seed-chip";

/** How a picked team stands against the results: right, wrong (or already out), or not played yet. */
export type TeamLineMark = "right" | "wrong" | "none";

export type TeamLineProps = {
  /** The team's name, or for an open line, whose winner fills it ("Sweet 16 winner"). */
  name: string;
  seed?: number | null;
  mark?: TeamLineMark;
  /** On a wrong line, the team that really won its place, shown in grey after the struck name. */
  actualName?: string | null;
  /** The entry's pick in this game, while picks can still change. */
  isPicked?: boolean;
  /** An open line, waiting for an earlier pick to fill it. */
  isOpen?: boolean;
  /** The right half of a bracket reads toward the middle: the seed after the name. */
  isMirrored?: boolean;
  /** Tapping the line picks the team; without it the line is read-only. */
  onPick?: () => void;
  /** A pick is saving, so no other can start. */
  disabled?: boolean;
  testId?: string;
};

const MARK_CLASS_NAMES: Record<TeamLineMark, string> = {
  right: "border-done/60 font-semibold text-done",
  wrong: "border-destructive/50 text-destructive",
  none: "border-border text-foreground",
};

/**
 * One team on one line of a bracket (#1753): its seed in a navy square, its name, and once its
 * game is decided a green ✓ or a red ✗ with the name struck through and the real winner in grey.
 * A line the entry can still pick is a button, pressed while it is the pick; tapping the pick
 * again does nothing, since the other line is how a pick changes.
 */
export function TeamLine({
  actualName = null,
  disabled = false,
  isMirrored = false,
  isOpen = false,
  isPicked = false,
  mark = "none",
  name,
  onPick,
  seed = null,
  testId,
}: TeamLineProps) {
  const lineClassName = cn(
    "flex h-7 w-full min-w-0 items-center gap-1 rounded-md border bg-card px-1.5 text-xs",
    isMirrored && "flex-row-reverse text-right",
    isOpen ? "border-dashed text-muted-foreground" : MARK_CLASS_NAMES[mark],
    isPicked && "border-selected font-semibold ring-1 ring-selected",
  );
  const content = (
    <>
      {seed === null || isOpen ? null : <SeedChip seed={seed} />}
      <span className={cn("min-w-0 truncate", mark === "wrong" && "line-through")}>{name}</span>
      {mark === "right" ? <Check aria-label="Right" className="shrink-0" size={12} strokeWidth={3} /> : null}
      {mark === "wrong" ? <X aria-label="Wrong" className="shrink-0" size={12} strokeWidth={3} /> : null}
      {mark === "wrong" && actualName ? (
        <span className="min-w-0 truncate font-normal text-muted-foreground" data-actual="">{actualName}</span>
      ) : null}
    </>
  );
  if (onPick && !isOpen) {
    return (
      <Button
        aria-pressed={isPicked}
        className={cn(lineClassName, "justify-start font-normal normal-case tracking-normal hover:bg-muted/40", isMirrored && "justify-start")}
        data-mark={mark}
        data-testid={testId}
        disabled={disabled}
        onClick={() => {
          if (!isPicked) onPick();
        }}
        size="xs"
        type="button"
        variant="secondary"
      >
        {content}
      </Button>
    );
  }
  return (
    <div className={lineClassName} data-mark={isOpen ? undefined : mark} data-picked={isPicked || undefined} data-testid={testId}>
      {content}
    </div>
  );
}
