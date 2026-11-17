import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { HeroTile } from "./hero-tile";

function drawHero(props: Partial<Parameters<typeof HeroTile>[0]> = {}) {
  render(
    <MemoryRouter>
      <HeroTile edge="open" eyebrow={<span>Open for entries</span>} testId="hero" title="NBA Finals Stars" to="/contests/c1" {...props} />
    </MemoryRouter>,
  );
}

describe("HeroTile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a section named by its title, with a link over the whole tile named the same", () => {
    drawHero();

    const hero = screen.getByRole("region", { name: "NBA Finals Stars" });
    expect(within(hero).getByRole("heading", { level: 2, name: "NBA Finals Stars" })).toBeVisible();
    expect(within(hero).getByRole("link", { name: "NBA Finals Stars" })).toHaveAttribute("href", "/contests/c1");
    expect(within(hero).getByText("Open for entries")).toBeVisible();
  });

  it("keeps its buttons outside the link, on their own row, and drops the row when it has none", () => {
    drawHero({ actions: <Button>Make your picks</Button> });

    const button = screen.getByRole("button", { name: "Make your picks" });
    expect(screen.getByTestId("hero-link")).not.toContainElement(button);
    expect(screen.getByTestId("hero-actions")).toContainElement(button);
  });

  it("draws no button row without actions", () => {
    drawHero();

    expect(screen.queryByTestId("hero-actions")).not.toBeInTheDocument();
  });

  it("marks itself and scrolls into view when highlighted", () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");

    drawHero({ isHighlighted: true });

    expect(screen.getByTestId("hero")).toHaveAttribute("data-highlighted", "true");
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("is neither marked nor scrolled to when not highlighted", () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");

    drawHero();

    expect(screen.getByTestId("hero")).not.toHaveAttribute("data-highlighted");
    expect(scroll).not.toHaveBeenCalled();
  });
});
