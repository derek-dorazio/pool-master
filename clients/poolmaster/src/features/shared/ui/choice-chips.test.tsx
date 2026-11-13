import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installScrollRowLayout } from "@/test/scroll-row-layout";
import { ChoiceChips } from "./choice-chips";

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

const SPORTS = [
  { isChosen: false, label: "All sports", to: "?" },
  { isChosen: false, label: "Golf", to: "?sport=golf" },
  { isChosen: true, label: "Hockey", to: "?sport=hockey" },
  { isChosen: false, label: "Soccer", to: "?sport=soccer" },
];

function renderChips(props: Partial<Parameters<typeof ChoiceChips>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={["/how-to-play?sport=hockey"]}>
      <ChoiceChips aria-label="Sport" items={SPORTS} {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("ChoiceChips", () => {
  it("offers each choice as a link in one named row, marking the chosen one current in the selected blue", () => {
    renderChips();

    expect(screen.getByRole("navigation", { name: "Sport" })).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("link", { name: "Hockey" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Hockey" })).toHaveClass("bg-selected");
    expect(screen.getByRole("link", { name: "Golf" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Golf" })).toHaveAttribute("href", "/how-to-play?sport=golf");
  });

  it("follows a choice's link and runs its onClick", () => {
    const onClick = vi.fn();
    renderChips({ items: SPORTS.map((item) => ({ ...item, onClick })) });

    fireEvent.click(screen.getByRole("link", { name: "Soccer" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/how-to-play?sport=soccer");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("draws a narrower choice in the place of the one it narrows, chosen, and its × clears it back to that one", () => {
    renderChips({ clearable: { label: "NHL · Stanley Cup Final", replaces: "?sport=hockey", testId: "clear" } });

    expect(screen.queryByRole("link", { name: "Hockey" })).not.toBeInTheDocument();
    const clear = screen.getByRole("link", { name: "Clear NHL · Stanley Cup Final" });
    expect(clear).toHaveTextContent("NHL · Stanley Cup Final");
    expect(clear).toHaveClass("bg-selected");
    expect(clear).toHaveAttribute("data-chosen", "true");
    // Only the narrower choice reads as chosen.
    expect(screen.queryByRole("link", { current: "page" })).not.toBeInTheDocument();

    fireEvent.click(clear);
    expect(screen.getByTestId("location")).toHaveTextContent("/how-to-play?sport=hockey");
  });

  it("wraps instead of scrolling for a list of every choice", () => {
    renderChips({ layout: "wrap" });

    expect(screen.getByRole("navigation", { name: "Sport" })).toHaveClass("flex-wrap");
    expect(screen.getByRole("navigation", { name: "Sport" })).not.toHaveClass("overflow-x-auto");
  });
});

describe("ChoiceChips on a phone-width row", () => {
  let restoreLayout: () => void = () => undefined;
  beforeEach(() => {
    restoreLayout = installScrollRowLayout({ rowWidth: 250, tabWidth: 100 }).restore;
  });
  afterEach(() => restoreLayout());

  it("opens scrolled so the narrower choice standing in for the last chip is fully in view", () => {
    renderChips({ clearable: { label: "Premier League", replaces: "?sport=soccer" } });

    // Soccer's place spans 300-400; a 250px row scrolled to its end shows 150-400.
    expect(screen.getByRole("navigation", { name: "Sport" }).scrollLeft).toBe(150);
  });
});
