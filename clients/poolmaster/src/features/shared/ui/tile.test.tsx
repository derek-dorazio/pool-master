import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tile } from "./tile";

describe("pool-master-3lo.2 / pool-master-fo5.4: shared Tile primitive", () => {
  it("rule: renders a semantic surface variant with caller-provided attributes", () => {
    render(
      <Tile data-testid="tile" variant="interactive">
        Open contest
      </Tile>,
    );

    const tile = screen.getByTestId("tile");

    expect(tile).toHaveTextContent("Open contest");
    expect(tile).toHaveClass(
      "bg-[var(--workflow-default-surface)]",
      "hover:bg-[var(--workflow-default-hover-surface)]",
    );
  });

  it("draws the navy panel with its own border and light text, so content on it needs no colour of its own", () => {
    render(<Tile data-testid="tile" variant="inverse">Up next</Tile>);

    expect(screen.getByTestId("tile")).toHaveClass("bg-surface-inverse", "border-inverse-border", "text-on-inverse");
    expect(screen.getByTestId("tile")).not.toHaveClass("bg-card");
  });

  it("draws the deeper navy for a panel that sits inside or apart from a navy one", () => {
    render(<Tile data-testid="tile" variant="inverseDeep">Example card</Tile>);

    expect(screen.getByTestId("tile")).toHaveClass("bg-surface-inverse-deep", "text-on-inverse");
  });

  it("renders as a labelled section when asked, so a hero stays a page region", () => {
    render(
      <Tile aria-labelledby="t" as="section" variant="inverse">
        <h2 id="t">Up next</h2>
      </Tile>,
    );

    expect(screen.getByRole("region", { name: "Up next" }).tagName).toBe("SECTION");
  });
});
