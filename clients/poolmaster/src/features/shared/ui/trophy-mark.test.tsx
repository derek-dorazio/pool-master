import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrophyMark } from "./trophy-mark";

describe("TrophyMark", () => {
  it("draws the trophy gold while its team is still in, hidden from screen readers since the words beside it say the same", () => {
    render(<TrophyMark />);
    const svg = screen.getByTestId("trophy-mark");

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("text-gold-500");
    expect(svg).not.toHaveAttribute("data-out");
  });

  it("greys the trophy once its team is out", () => {
    render(<TrophyMark isOut />);
    const svg = screen.getByTestId("trophy-mark");

    expect(svg).toHaveClass("text-muted-foreground");
    expect(svg).toHaveAttribute("data-out", "true");
  });
});
