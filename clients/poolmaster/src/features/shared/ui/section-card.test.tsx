import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SectionBody, SectionCard, SectionEmpty, SectionFooterLink, SectionNote, SectionRow, SectionRows, SectionStack, SectionTitle } from "./section-card";

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

  it("marks a danger zone with a red border and a red title that defaults to Danger zone", () => {
    render(<SectionCard testId="card" tone="danger"><p>Body</p></SectionCard>);

    expect(screen.getByTestId("card")).toHaveClass("border-destructive/40");
    expect(screen.getByRole("heading", { name: "Danger zone" })).toHaveClass("text-destructive");
  });

  it("tells a danger zone's reader that its actions confirm first, unless the zone says otherwise", () => {
    const { rerender } = render(<SectionCard testId="card" tone="danger"><p>Body</p></SectionCard>);
    fireEvent.click(screen.getByTestId("card-help"));
    expect(screen.getByTestId("card-help-callout")).toHaveTextContent("Each of these asks you to confirm.");

    rerender(<SectionCard help="Leaving asks you to confirm." testId="card" title="Leave" tone="danger"><p>Body</p></SectionCard>);
    expect(screen.getByRole("heading", { name: "Leave" })).toBeVisible();
    expect(screen.getByTestId("card-help-callout")).toHaveTextContent("Leaving asks you to confirm.");
  });

  it("renders an h3 heading with its test id when asked for heading level 3", () => {
    render(
      <SectionCard headingLevel={3} title="Contests" titleTestId="card-title">
        <p>Body</p>
      </SectionCard>,
    );

    expect(screen.getByRole("heading", { level: 3, name: "Contests" })).toHaveAttribute("data-testid", "card-title");
  });

  it("titles a section nested inside another section with an h4", () => {
    render(<SectionCard headingLevel={4} title="Over 20 entries">{null}</SectionCard>);

    expect(screen.getByRole("heading", { level: 4, name: "Over 20 entries" })).toBeInTheDocument();
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

describe("SectionCard help", () => {
  it("names the (?) after the section's test id, so two sections on a page keep apart", () => {
    render(
      <>
        <SectionCard help="What members see." testId="general" title="General"><p>a</p></SectionCard>
        <SectionCard help="What each place earns." testId="cups" title="Championships"><p>b</p></SectionCard>
      </>,
    );

    fireEvent.click(screen.getByTestId("cups-help"));
    expect(screen.getByTestId("cups-help-callout")).toHaveTextContent("What each place earns.");
    expect(screen.queryByTestId("general-help-callout")).not.toBeInTheDocument();
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

  it("leads with its checkbox and makes the whole row the checkbox's label, so a tap on the name toggles it", () => {
    const onChange = vi.fn();
    render(
      <SectionRows>
        <SectionRow control={<input onChange={onChange} type="checkbox" />} facts="Weekly" name="League digest" testId="row" />
      </SectionRows>,
    );

    const row = screen.getByTestId("row");
    expect(row.tagName).toBe("LABEL");
    expect(row).toContainElement(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("League digest"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox", { name: /League digest/ })).toBeChecked();
  });

  it("leads with its picture before the name when given one, and draws no picture frame without one", () => {
    const { rerender } = render(
      <SectionRows>
        <SectionRow name="Masters Pool" picture={<svg data-testid="picture" />} testId="row" />
      </SectionRows>,
    );

    const frame = screen.getByTestId("row-picture");
    expect(frame).toContainElement(screen.getByTestId("picture"));
    expect(frame).toHaveClass("aspect-[16/10]");
    expect(frame.compareDocumentPosition(screen.getByText("Masters Pool")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(
      <SectionRows>
        <SectionRow name="Masters Pool" testId="row" />
      </SectionRows>,
    );
    expect(screen.queryByTestId("row-picture")).not.toBeInTheDocument();
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

describe("SectionCard edit", () => {
  it("puts one Edit button in the title, named for the section, that asks to open its dialog", () => {
    const onEdit = vi.fn();
    render(
      <SectionCard edit={{ onClick: onEdit, testId: "profile-edit" }} title="Profile">
        <SectionRows><SectionRow layout="setting" name="Name" value="Sam Lee" /></SectionRows>
      </SectionCard>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Profile" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("profile-edit")).toHaveTextContent("Edit");
  });

  it("names the Edit button for a section whose title is not plain text \"Edit section\"", () => {
    render(
      <SectionCard edit={{ onClick: vi.fn() }} title={<span>Profile</span>}>
        <SectionRows><SectionRow layout="setting" name="Name" value="Sam Lee" /></SectionRows>
      </SectionCard>,
    );

    expect(screen.getByRole("button", { name: "Edit section" })).toBeInTheDocument();
  });

  it("shows no Edit button for a section without edit", () => {
    render(
      <SectionCard title="Profile">
        <SectionRows><SectionRow layout="setting" name="Name" value="Sam Lee" /></SectionRows>
      </SectionCard>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("SectionRow setting layout", () => {
  it("shows the setting's name at the left and its current value at the right, as a list item", () => {
    render(
      <SectionRows>
        <SectionRow layout="setting" name="Username" testId="profile-username" value="samlee" valueTestId="profile-username-value" />
      </SectionRows>,
    );

    const row = screen.getByTestId("profile-username");
    expect(row).toHaveClass("justify-between");
    expect(row).toHaveTextContent("Usernamesamlee");
    expect(screen.getByTestId("profile-username-value")).toHaveClass("font-semibold", "text-sm");
    expect(screen.getByRole("listitem")).toContainElement(row);
  });

  it("keeps a row's own control, such as a switch, at the row's end in place of a value", () => {
    render(
      <SectionRows>
        <SectionRow aside={<button type="button">Turn off</button>} layout="setting" name="Results" testId="results" />
      </SectionRows>,
    );

    expect(within(screen.getByTestId("results")).getByRole("button", { name: "Turn off" })).toBeInTheDocument();
  });
});

describe("SectionRow action layout", () => {
  it("shows a danger action's whole name and what it does in its own block, with its button under them on a phone and beside them from sm", () => {
    render(
      <SectionRows>
        <SectionRow
          aside={<button type="button">Inactivate league</button>}
          facts={<><span>Stops new entries.</span><span>Could not do it.</span></>}
          layout="action"
          name="Inactivate a league with a long name"
          testId="inactivate"
        />
      </SectionRows>,
    );

    const row = screen.getByTestId("inactivate");
    expect(row).toHaveClass("flex-col", "sm:flex-row");
    expect(screen.getByText("Inactivate a league with a long name")).not.toHaveClass("truncate");
    expect(row).toHaveTextContent("Inactivate a league with a long nameStops new entries.Could not do it.");
    expect(within(row).getByRole("button", { name: "Inactivate league" })).toBeInTheDocument();
  });

  it("does not tint on hover, since the row itself does nothing when clicked", () => {
    render(
      <SectionRows>
        <SectionRow aside={<button type="button">Delete</button>} layout="action" name="Delete contest" testId="delete" />
      </SectionRows>,
    );

    expect(screen.getByTestId("delete").className).not.toMatch(/hover:/);
    expect(screen.getByRole("listitem").className).not.toMatch(/hover:/);
  });
});

describe("SectionStack", () => {
  it("divides a section's row list from a form or notice beside it, like rows", () => {
    render(
      <SectionStack testId="stack">
        <SectionRows><SectionRow layout="setting" name="Entries" value="12" /></SectionRows>
        <SectionBody testId="stack-body">A notice</SectionBody>
      </SectionStack>,
    );

    expect(screen.getByTestId("stack")).toHaveClass("divide-y", "divide-border");
    expect(screen.getByTestId("stack-body")).toHaveTextContent("A notice");
  });
});
