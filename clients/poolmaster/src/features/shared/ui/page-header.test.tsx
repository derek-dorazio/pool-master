import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { PageHeader } from "./page-header";
import { PageTabs } from "./page-tabs";

function renderHeader(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("PageHeader", () => {
  it("shows the title as the page's one h1, straight on the page with no card around it", () => {
    renderHeader(<PageHeader testId="members" title="Members" />);

    const heading = screen.getByRole("heading", { level: 1, name: "Members" });
    expect(heading).toHaveAttribute("data-testid", "members-name");
    expect(screen.getByTestId("members").tagName).toBe("HEADER");
    expect(screen.getByTestId("members-title-row")).not.toHaveClass("bg-card", "border", "rounded-lg");
  });

  it("rules off the title row when the page has no tabs", () => {
    renderHeader(<PageHeader testId="home" title="Big Dawgs" />);

    expect(screen.getByTestId("home-title-row")).toHaveClass("border-b");
  });

  it("draws an icon in the avatar square named after the title", () => {
    renderHeader(<PageHeader icon={<span>🏆</span>} title="Big Dawgs" />);

    expect(screen.getByLabelText("Big Dawgs icon")).toHaveTextContent("🏆");
  });

  it("shows the caller's own avatar in place of the standard square, so a team icon keeps its colours", () => {
    renderHeader(
      <PageHeader avatar={<span aria-label="Casey Crushers icon" className="team-icon-theme-ocean" />} title="Casey Crushers" />,
    );

    expect(screen.getByLabelText("Casey Crushers icon")).toHaveClass("team-icon-theme-ocean");
    expect(screen.getAllByLabelText("Casey Crushers icon")).toHaveLength(1);
  });

  it("shows no picture when given neither an icon nor an avatar", () => {
    renderHeader(<PageHeader title="Members" />);

    expect(screen.queryByLabelText("Members icon")).not.toBeInTheDocument();
  });

  it("shows the fact line and the rule line under the title", () => {
    renderHeader(
      <PageHeader
        description="Members never see which plan it is on."
        meta={<span>12 members · 2 active contests</span>}
        title="Plan"
      />,
    );

    expect(screen.getByText("12 members · 2 active contests")).toBeInTheDocument();
    expect(screen.getByText("Members never see which plan it is on.")).toBeInTheDocument();
  });

  it("puts actions in the right slot beside the title, wrapping under it only when they don't fit", () => {
    renderHeader(<PageHeader actions={<Button>Edit team</Button>} testId="team" title="Casey Crushers" />);

    const slot = screen.getByTestId("team-actions");
    expect(within(slot).getByRole("button", { name: "Edit team" })).toBeInTheDocument();
    expect(slot).not.toHaveClass("max-sm:basis-full");
  });

  it("puts the page's search in the right slot, taking a full-width line on a phone", () => {
    renderHeader(<PageHeader search={<input aria-label="Find a member" type="search" />} testId="members" title="Members" />);

    const slot = screen.getByTestId("members-search");
    expect(within(slot).getByRole("searchbox", { name: "Find a member" })).toBeInTheDocument();
    expect(slot).toHaveClass("max-sm:basis-full", "sm:w-72");
    expect(screen.queryByTestId("members-actions")).not.toBeInTheDocument();
  });

  it("links each breadcrumb up the trail and marks the current page", () => {
    renderHeader(
      <PageHeader breadcrumbs={[{ href: "/manage", label: "Manage" }, { label: "Users" }]} title="Users" />,
    );

    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/manage");
    expect(screen.getByText("Users", { selector: "span" })).toHaveAttribute("aria-current", "page");
  });

  it("puts the tabs on the header's ruled bottom line with the filter at its right end", () => {
    renderHeader(
      <PageHeader
        tabs={(
          <PageTabs
            aria-label="Championship views"
            items={[{ isActive: true, label: "Championship", to: "/c" }]}
            variant="link"
          />
        )}
        tabsEnd={<span>Season 2026</span>}
        testId="race"
        title="2026 Championship Race"
      />,
    );

    const tabRow = within(screen.getByTestId("race-tab-row"));
    expect(screen.getByTestId("race-tab-row")).toHaveClass("sm:border-b");
    expect(tabRow.getByRole("navigation", { name: "Championship views" })).toBeInTheDocument();
    expect(tabRow.getByText("Season 2026")).toBeInTheDocument();
    expect(screen.getByTestId("race-title-row")).not.toHaveClass("border-b");
  });

  it("leaves out a tab-row filter when there are no tabs to sit beside", () => {
    renderHeader(<PageHeader tabsEnd={<span>Season 2026</span>} title="Championships" />);

    expect(screen.queryByText("Season 2026")).not.toBeInTheDocument();
  });
});
