import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { PanelCard, PanelList } from "./panel-card";

describe("PanelCard", () => {
  it("names the section after a plain-string title and puts the title in a ruled bar heading", () => {
    render(
      <PanelCard testId="panel" title="Standings">
        <p>Body</p>
      </PanelCard>,
    );

    const section = screen.getByRole("region", { name: "Standings" });
    expect(section).toHaveAttribute("data-testid", "panel");
    expect(within(section).getByRole("heading", { level: 2, name: "Standings" })).toBeVisible();
    expect(within(section).getByText("Body")).toBeVisible();
  });

  it("names the section after its title even when the title is more than plain text", () => {
    render(
      <PanelCard testId="panel" title={<><span aria-hidden="true">★</span>Champions Cup</>}>
        <p>Body</p>
      </PanelCard>,
    );

    expect(screen.getByRole("region", { name: /Champions Cup/ })).toHaveAttribute("data-testid", "panel");
  });

  it("renders an h3 heading with its test id when asked for heading level 3", () => {
    render(
      <PanelCard headingLevel={3} title="Contests" titleTestId="panel-title">
        <p>Body</p>
      </PanelCard>,
    );

    expect(screen.getByRole("heading", { level: 3, name: "Contests" })).toHaveAttribute("data-testid", "panel-title");
  });

  it("shows the trailing slot beside the title", () => {
    render(
      <PanelCard title="Cup" trailing={<span data-testid="panel-badge">Final</span>}>
        <p>Body</p>
      </PanelCard>,
    );

    expect(screen.getByTestId("panel-badge")).toHaveTextContent("Final");
  });

  it("links the footer to its destination with an arrow after the label", () => {
    render(
      <MemoryRouter>
        <PanelCard footer={{ label: "See all contests", testId: "panel-footer", to: "/contests" }} title="Contests">
          <p>Body</p>
        </PanelCard>
      </MemoryRouter>,
    );

    const footer = screen.getByTestId("panel-footer");
    expect(footer).toHaveAttribute("href", "/contests");
    expect(footer).toHaveTextContent("See all contests →");
  });

  it("wraps the body in the card's padding only when padded is set", () => {
    const { rerender } = render(
      <PanelCard testId="panel" title="Rows">
        <p>Body</p>
      </PanelCard>,
    );
    expect(screen.queryByTestId("panel-body")).not.toBeInTheDocument();

    rerender(
      <PanelCard padded testId="panel" title="Rows">
        <p>Body</p>
      </PanelCard>,
    );
    expect(screen.getByTestId("panel-body")).toHaveClass("p-4");
    expect(within(screen.getByTestId("panel-body")).getByText("Body")).toBeVisible();
  });

  it("divides its list rows with rules", () => {
    render(
      <PanelList testId="panel-list">
        <li>One</li>
        <li>Two</li>
      </PanelList>,
    );

    expect(screen.getByTestId("panel-list")).toHaveClass("divide-y");
    expect(within(screen.getByTestId("panel-list")).getAllByRole("listitem")).toHaveLength(2);
  });
});
