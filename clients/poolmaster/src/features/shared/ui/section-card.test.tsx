import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SectionBody, SectionCard, SectionEmpty, SectionFooterLink, SectionNote, SectionRow, SectionRows, SectionTitle } from "./section-card";

function inRouter(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("SectionCard", () => {
  it("names the section after its title and puts the title in a ruled bar heading", () => {
    render(
      <SectionCard testId="card" title="Standings">
        <p>Body</p>
      </SectionCard>,
    );

    const section = screen.getByRole("region", { name: "Standings" });
    expect(section).toHaveAttribute("data-testid", "card");
    expect(within(section).getByRole("heading", { level: 2, name: "Standings" })).toBeVisible();
    expect(within(section).getByText("Body")).toBeVisible();
  });

  it("names the section after its title even when the title is more than plain text", () => {
    render(
      <SectionCard testId="card" title={<><span aria-hidden="true">★</span>Champions Cup</>}>
        <p>Body</p>
      </SectionCard>,
    );

    expect(screen.getByRole("region", { name: /Champions Cup/ })).toHaveAttribute("data-testid", "card");
  });

  it("draws a box with 8px corners, and no box when bare while keeping the title and rule", () => {
    const { rerender } = render(<SectionCard testId="card" title="Rows"><p>Body</p></SectionCard>);
    expect(screen.getByTestId("card")).toHaveClass("rounded-lg", "border", "bg-card");

    rerender(<SectionCard bare testId="card" title="Owners"><p>Body</p></SectionCard>);
    expect(screen.getByTestId("card")).not.toHaveClass("border", "bg-card");
    expect(screen.getByRole("heading", { name: "Owners" })).toBeVisible();
  });

  it("marks a danger zone with a red border and red title", () => {
    render(<SectionCard testId="card" title="Danger zone" tone="danger"><p>Body</p></SectionCard>);

    expect(screen.getByTestId("card")).toHaveClass("border-destructive/40");
    expect(screen.getByRole("heading", { name: "Danger zone" })).toHaveClass("text-destructive");
  });

  it("renders an h3 heading with its test id when asked for heading level 3", () => {
    render(
      <SectionCard headingLevel={3} title="Contests" titleTestId="card-title">
        <p>Body</p>
      </SectionCard>,
    );

    expect(screen.getByRole("heading", { level: 3, name: "Contests" })).toHaveAttribute("data-testid", "card-title");
  });

  it("wraps the body in the card's padding only when padded is set", () => {
    const { rerender } = render(<SectionCard testId="card" title="Rows"><p>Body</p></SectionCard>);
    expect(screen.queryByTestId("card-body")).not.toBeInTheDocument();

    rerender(<SectionCard padded testId="card" title="Rows"><p>Body</p></SectionCard>);
    expect(screen.getByTestId("card-body")).toHaveClass("p-4");
  });

  it("ends with the footer link when it has one", () => {
    inRouter(
      <SectionCard footer={{ label: "All contests", testId: "card-footer", to: "/contests" }} title="Contests">
        <p>Body</p>
      </SectionCard>,
    );

    expect(screen.getByTestId("card-footer")).toHaveAttribute("href", "/contests");
  });
});

describe("SectionTitle", () => {
  it("shows how the section works behind a (?) help tip, not on the page", () => {
    render(<SectionTitle help="Finished ones are under Past." testId="title" title="Current contests" />);

    expect(screen.queryByText("Finished ones are under Past.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "How this section works" }));
    expect(screen.getByTestId("title-help-callout")).toHaveTextContent("Finished ones are under Past.");
  });

  it("shows no (?) without help text", () => {
    render(<SectionTitle title="Yours" />);

    expect(screen.queryByRole("button", { name: "How this section works" })).not.toBeInTheDocument();
  });

  it("puts the trailing badge or count in the title bar beside the title", () => {
    render(<SectionTitle title="Finishes" trailing={<span data-testid="count">3 contests final</span>} />);

    expect(screen.getByTestId("count")).toHaveTextContent("3 contests final");
    expect(screen.getByRole("heading", { name: "Finishes" })).not.toHaveTextContent("3 contests final");
  });
});

describe("SectionRow", () => {
  it("shows the name, its fact lines and its figure in the shared row type", () => {
    render(
      <SectionRows testId="rows">
        <SectionRow aside={<span>Live</span>} facts="Live · 14 entries" name="NFL Week 12" note="You're 3rd" value="3rd" valueTestId="value" />
      </SectionRows>,
    );

    expect(screen.getByText("NFL Week 12")).toHaveClass("font-semibold", "text-foreground");
    expect(screen.getByText("Live · 14 entries")).toHaveClass("text-sm", "text-muted-foreground");
    expect(screen.getByText("You're 3rd")).toHaveClass("text-sm", "text-muted-foreground");
    expect(screen.getByTestId("value")).toHaveClass("font-semibold", "tabular-nums");
    expect(within(screen.getByTestId("rows")).getByText("Live")).toBeInTheDocument();
  });

  it("shades every other row and tints a row on hover", () => {
    render(
      <SectionRows testId="rows">
        <SectionRow name="One" testId="one" />
        <SectionRow name="Two" testId="two" />
      </SectionRows>,
    );

    const items = within(screen.getByTestId("rows")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    items.forEach((item) => expect(item).toHaveClass("even:bg-row-alt"));
    expect(screen.getByTestId("one")).toHaveClass("hover:bg-row-hover");
  });

  it("opens its destination from anywhere on the row when it has one", () => {
    inRouter(
      <SectionRows>
        <SectionRow name="Masters" testId="row" to="/contests/1" />
      </SectionRows>,
    );

    expect(screen.getByTestId("row")).toHaveAttribute("href", "/contests/1");
  });

  it("tints the row the viewer came from and scrolls it into view", () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(
      <SectionRows>
        <SectionRow isHighlighted name="Masters" testId="row" />
      </SectionRows>,
    );

    expect(screen.getByTestId("row")).toHaveAttribute("data-highlighted", "true");
    expect(screen.getByTestId("row")).toHaveClass("bg-primary/10");
    expect(scroll).toHaveBeenCalledTimes(1);
    scroll.mockRestore();
  });

  it("marks the chosen row current and tinted without scrolling to it", () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    inRouter(
      <SectionRows>
        <SectionRow isSelected name="2025" testId="row" to="/team?year=2025" />
      </SectionRows>,
    );

    expect(screen.getByTestId("row")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("row")).toHaveClass("bg-primary/10");
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it("leaves an ordinary row untinted, unmarked and without a figure", () => {
    render(
      <SectionRows>
        <SectionRow name="Masters" testId="row" valueTestId="value" />
      </SectionRows>,
    );

    expect(screen.getByTestId("row")).not.toHaveAttribute("data-highlighted");
    expect(screen.getByTestId("row")).not.toHaveAttribute("aria-current");
    expect(screen.queryByTestId("value")).not.toBeInTheDocument();
  });
});

describe("SectionBody", () => {
  it("pads a grid or chart that sits beside rows in the same card", () => {
    render(<SectionBody testId="body"><p>Grid</p></SectionBody>);

    expect(screen.getByTestId("body")).toHaveClass("p-4");
    expect(screen.getByText("Grid")).toBeVisible();
  });
});

describe("SectionNote", () => {
  it("draws a line about the data muted, and in the body colour when it leads the section", () => {
    const { rerender } = render(<SectionNote testId="note">If the live contests ended now…</SectionNote>);
    expect(screen.getByTestId("note")).toHaveClass("text-sm", "text-muted-foreground");

    rerender(<SectionNote testId="note" tone="default">Birdie Bandits leads by 15 points.</SectionNote>);
    expect(screen.getByTestId("note")).toHaveClass("text-sm", "text-foreground");
    expect(screen.getByTestId("note")).not.toHaveClass("text-muted-foreground");
  });
});

describe("SectionEmpty", () => {
  it("says there is nothing in one italic muted line", () => {
    render(<SectionEmpty testId="empty">No open or live contests.</SectionEmpty>);

    expect(screen.getByTestId("empty")).toHaveTextContent("No open or live contests.");
    expect(screen.getByTestId("empty")).toHaveClass("italic", "text-muted-foreground");
  });
});

describe("SectionFooterLink", () => {
  it("links on in blue small caps with an arrow, never as a button", () => {
    inRouter(<SectionFooterLink label="All contests" testId="footer" to="/contests" />);

    const link = screen.getByTestId("footer");
    expect(link).toHaveAttribute("href", "/contests");
    expect(link).toHaveTextContent("All contests→");
    expect(link).toHaveClass("uppercase", "text-label", "font-display");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
