import type { ReactNode } from "react";
import { cn } from "./class-names";

/**
 * The parts of a game board drawn as a grid of small cells, such as the 10x10 squares board
 * (#1758): the navy team bands along its edges, the numbers beside the rows and columns, and the
 * cells, each holding a short code and perhaps a corner tag. The cells are small enough for the
 * whole board to fit a phone, so a cell never holds a full name: that goes in a `DetailsPeek`
 * with `trigger="cell"` around it. A page composes these into its own table and decides what a
 * cell means; the look stays here.
 */

/** A navy band naming a team: across the top of the board, or down its side. */
export function BoardBand({ name, side, testId }: { name: string; side: "top" | "left"; testId: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center truncate rounded-sm bg-surface-inverse px-1 text-xs font-bold uppercase tracking-label text-on-inverse",
        // Down the side it fills its cell, which spans the rows, without setting their height:
        // the cell needs `relative`.
        side === "top" ? "h-6" : "absolute inset-0 rotate-180 py-1 [writing-mode:vertical-rl]",
      )}
      data-testid={testId}
    >
      {name}
    </div>
  );
}

/**
 * What a board cell holds: its short code, hidden from screen readers since the cell's name says
 * it in full, and a corner tag, such as the period it won ("Q1") or "Now".
 */
export function BoardCellContent({ code, tag }: { code: string; tag?: { label: ReactNode; tone: "won" | "now" } }) {
  return (
    <>
      <span aria-hidden>{code}</span>
      {tag ? (
        <span
          className={cn(
            "pointer-events-none absolute -right-1 -top-1.5 z-10 rounded-sm px-0.5 text-2xs font-bold uppercase",
            tag.tone === "now" ? "bg-done text-done-foreground" : "bg-surface-inverse text-on-inverse",
          )}
        >
          {tag.label}
        </span>
      ) : null}
    </>
  );
}
