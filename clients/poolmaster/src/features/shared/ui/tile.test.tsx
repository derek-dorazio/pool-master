import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tile } from "./tile";

describe("pool-master-3lo.2: shared Tile primitive", () => {
  it("rule: renders a semantic surface variant with caller-provided attributes", () => {
    render(
      <Tile data-testid="tile" variant="interactive">
        Open contest
      </Tile>,
    );

    const tile = screen.getByTestId("tile");

    expect(tile).toHaveTextContent("Open contest");
    expect(tile).toHaveClass("bg-background");
    expect(tile).toHaveClass("hover:bg-card");
  });
});
