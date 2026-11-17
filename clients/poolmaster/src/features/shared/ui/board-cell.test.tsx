import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BoardBand, BoardCellContent } from "./board-cell";
import { boardAxisClassName, boardCellClassName } from "./board-cell-styles";

const PLAIN = { isEmpty: false, isMine: false, isWon: false, isNow: false, isOnLiveLine: false };

describe("board cells", () => {
  it("draws an empty cell dashed and blank, and a held one solid", () => {
    expect(boardCellClassName({ ...PLAIN, isEmpty: true })).toContain("border-dashed");
    expect(boardCellClassName(PLAIN)).not.toContain("border-dashed");
  });

  it("shades and outlines the viewer's own cell in the selected blue", () => {
    expect(boardCellClassName({ ...PLAIN, isMine: true })).toEqual(expect.stringContaining("border-selected"));
    expect(boardCellClassName({ ...PLAIN, isMine: true })).toEqual(expect.stringContaining("bg-selected/15"));
  });

  it("fills a winning cell gold over the viewer's blue shading, keeping the blue outline", () => {
    const classes = boardCellClassName({ ...PLAIN, isMine: true, isWon: true }).split(" ");
    expect(classes).toContain("bg-accent/30");
    expect(classes).not.toContain("bg-selected/15");
    expect(classes).toContain("border-selected");
  });

  it("outlines the cell winning now in green and tints the live row and column", () => {
    expect(boardCellClassName({ ...PLAIN, isNow: true }).split(" ")).toContain("outline-done");
    expect(boardCellClassName({ ...PLAIN, isOnLiveLine: true }).split(" ")).toContain("bg-done/10");
    expect(boardAxisClassName(true).split(" ")).toContain("bg-done/20");
    expect(boardAxisClassName(false).split(" ")).not.toContain("bg-done/20");
  });

  it("shows a cell's code hidden from screen readers, with its corner tag", () => {
    render(<div data-testid="cell"><BoardCellContent code="BH" tag={{ label: "Q1/Final", tone: "won" }} /></div>);

    expect(screen.getByTestId("cell")).toHaveTextContent("BHQ1/Final");
    expect(screen.getByText("BH")).toHaveAttribute("aria-hidden");
  });

  it("names a team in a navy band across the top or filling a side cell", () => {
    render(
      <>
        <BoardBand name="Eagles" side="top" testId="top" />
        <BoardBand name="Chiefs" side="left" testId="side" />
      </>,
    );

    expect(screen.getByTestId("top")).toHaveTextContent("Eagles");
    expect(screen.getByTestId("top")).toHaveClass("bg-surface-inverse", "h-6");
    expect(screen.getByTestId("side")).toHaveClass("absolute", "inset-0");
  });
});
