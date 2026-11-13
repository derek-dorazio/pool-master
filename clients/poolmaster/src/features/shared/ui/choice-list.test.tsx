import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ChoiceList } from "./choice-list";

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

describe("ChoiceList", () => {
  it("keeps a sport and its \"+ N more\" line as two lines though both open the sport, with no duplicate-key warning", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <MemoryRouter>
        <ChoiceList aria-label="Sports and leagues" items={[
          { isChosen: false, label: "Hockey", to: "?sport=hockey", tone: "heading" },
          { depth: 1, isChosen: false, label: "+ 3 more", to: "?sport=hockey", tone: "muted" },
        ]} />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Hockey", "+ 3 more"]);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("lists each choice as a link in a named column, indenting by depth, with a count at the line's end and the chosen line current", () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter initialEntries={["/how-to-play"]}>
        <ChoiceList
          aria-label="Sports and leagues"
          className="sticky"
          items={[
            { isChosen: false, label: "All sports", to: "?", tone: "heading" },
            { count: 8, isChosen: false, label: "Hockey", to: "?sport=hockey", tone: "heading" },
            { depth: 1, isChosen: false, label: "NHL", onClick, to: "?sport=hockey&league=nhl" },
            { depth: 2, isChosen: true, label: "Stanley Cup Final", to: "?sport=hockey&league=nhl&part=stanley-cup-final" },
            { depth: 1, isChosen: false, label: "+ 3 more", to: "?sport=soccer", tone: "muted" },
          ]}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    const column = screen.getByRole("navigation", { name: "Sports and leagues" });
    expect(column).toHaveClass("sticky");
    expect(screen.getByRole("link", { name: "Hockey 8" })).toHaveClass("pl-2", "font-display");
    expect(screen.getByRole("link", { name: "NHL" })).toHaveClass("pl-4");
    expect(screen.getByRole("link", { name: "Stanley Cup Final" })).toHaveClass("pl-7", "border-selected");
    expect(screen.getByRole("link", { name: "Stanley Cup Final" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "+ 3 more" })).toHaveClass("text-muted-foreground");
    expect(screen.getByRole("link", { name: "NHL" })).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("link", { name: "NHL" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/how-to-play?sport=hockey&league=nhl");
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
