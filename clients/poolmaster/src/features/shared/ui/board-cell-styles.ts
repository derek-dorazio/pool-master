import { cn } from "./class-names";

/** The looks of a board's cells and row and column numbers (`BoardBand` and `BoardCellContent` are in `board-cell.tsx`). */

/** What a cell shows about itself. Several can hold at once: a cell of the viewer's that won. */
export type BoardCellState = {
  /** Nobody holds it: a dashed, blank cell. */
  isEmpty: boolean;
  /** The viewer's own: shaded and outlined in the selected blue, as their rows are on other boards. */
  isMine: boolean;
  /** It won something: gold. */
  isWon: boolean;
  /** It is winning what is being played now: outlined in the status green. */
  isNow: boolean;
  /** It lies on the row or column of what is being played now: tinted green. */
  isOnLiveLine: boolean;
};

/** A board cell's look, for the element that draws the cell, be it a box, a button's frame or a peek. */
export function boardCellClassName({ isEmpty, isMine, isWon, isNow, isOnLiveLine }: BoardCellState): string {
  return cn(
    "relative flex h-7 w-full items-center justify-center rounded-sm border text-xs font-semibold sm:h-10",
    isEmpty ? "border-dashed border-border bg-background" : "border-border bg-card text-muted-foreground",
    isOnLiveLine && "bg-done/10",
    isMine && "border-2 border-selected bg-selected/15 font-bold text-foreground",
    isWon && "bg-accent/30 font-bold text-foreground",
    isNow && "text-foreground outline outline-2 -outline-offset-1 outline-done",
  );
}

/** The number beside a row or column of the board, tinted while that row or column is live. */
export function boardAxisClassName(isLive: boolean): string {
  return cn("h-6 rounded-sm bg-row-alt p-0 text-sm font-bold text-foreground", isLive && "bg-done/20");
}
