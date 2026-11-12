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

  it("ends each fact but the last with a dot, so a wrapped fact line never opens with one", () => {
    renderHeader(<PageHeader meta={<><span>Tiered</span><span>Entries: 6 of 100</span></>} testId="contest" title="Masters Pool" />);

    expect(within(screen.getByTestId("contest-meta")).getByText("Tiered")).toBeInTheDocument();
    expect(screen.getByTestId("contest-meta")).toHaveClass("[&>*:not(:last-child)]:after:content-['·']");
    expect(screen.getByTestId("contest-meta")).not.toHaveClass("[&>*+*]:before:content-['·']");
  });

  it("puts the breadcrumb on the header's first line, above the title", () => {
    renderHeader(
      <PageHeader breadcrumbs={[{ href: "/manage", label: "Manage" }, { label: "Users" }]} testId="users" title="Users" />,
    );

    const trailRow = screen.getByTestId("users-trail-row");
    expect(within(trailRow).getByRole("navigation", { name: "Breadcrumbs" })).toBeInTheDocument();
    expect(trailRow.compareDocumentPosition(screen.getByTestId("users-title-row")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the header's breadcrumb to one line, shortening later names but never the first, so the status chip keeps its place", () => {
    renderHeader(
      <PageHeader breadcrumbs={[{ href: "/contests", label: "Contests" }, { label: "A very long contest name" }]} title="A very long contest name" />,
    );

    const current = screen.getByText("A very long contest name", { selector: "span" });
    expect(within(screen.getByRole("navigation", { name: "Breadcrumbs" })).getByRole("list")).toHaveClass("flex-nowrap");
    expect(screen.getAllByRole("listitem").find((item) => item.textContent === "A very long contest name")).toHaveClass("truncate");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("listitem").find((item) => item.textContent === "Contests")).toHaveClass("shrink-0");
  });

  it("puts the status chip at the right end of the breadcrumb line when there is a trail", () => {
    renderHeader(
      <PageHeader
        actions={<Button>Edit</Button>}
        breadcrumbs={[{ href: "/contests", label: "Contests" }, { label: "Masters Pool" }]}
        status={<span>Live</span>}
        testId="contest"
        title="Masters Pool"
      />,
    );

    const slot = screen.getByTestId("contest-status-slot");
    expect(slot).toHaveTextContent("Live");
    expect(screen.getByTestId("contest-trail-row")).toContainElement(slot);
    expect(screen.getByTestId("contest-title-row")).not.toContainElement(slot);
  });

  it("ends the title row with the status chip, after the actions on a wide screen, when there is no trail", () => {
    renderHeader(
      <PageHeader actions={<Button>Edit team</Button>} status={<span>12 entries</span>} testId="team" title="Casey Crushers" />,
    );

    const slot = screen.getByTestId("team-status-slot");
    expect(slot).toHaveTextContent("12 entries");
    expect(screen.getByTestId("team-title-row")).toContainElement(slot);
    expect(slot).toHaveClass("sm:order-last");
    expect(screen.queryByTestId("team-trail-row")).not.toBeInTheDocument();
  });

  it("shows no status slot when the page has no status", () => {
    renderHeader(<PageHeader testId="members" title="Members" />);

    expect(screen.queryByTestId("members-status-slot")).not.toBeInTheDocument();
  });

  it("shows what the page puts beside the title, such as an info icon", () => {
    renderHeader(<PageHeader testId="entry" title="Birdie Hunters 2" titleAside={<button aria-label="Entry status">i</button>} />);

    const titleRow = within(screen.getByTestId("entry-title-row"));
    expect(titleRow.getByRole("heading", { level: 1, name: "Birdie Hunters 2" })).toBeInTheDocument();
    expect(titleRow.getByRole("button", { name: "Entry status" })).toBeInTheDocument();
  });

  it("takes several lines under the fact line, each its own paragraph", () => {
    renderHeader(<PageHeader description={<><p>Your best: 3rd.</p><p>Final standings.</p></>} title="Masters Pool" />);

    expect(screen.getByText("Your best: 3rd.").tagName).toBe("P");
    expect(screen.getByText("Final standings.")).toBeInTheDocument();
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

  it("gives a page filter with no tabs the bottom line to itself, over the rule, with the title row unruled", () => {
    renderHeader(<PageHeader tabsEnd={<span>Sport: Golf</span>} testId="how" title="How to Play" />);

    expect(within(screen.getByTestId("how-tab-row")).getByText("Sport: Golf")).toBeInTheDocument();
    expect(screen.getByTestId("how-tab-row")).toHaveClass("border-b");
    expect(screen.getByTestId("how-title-row")).not.toHaveClass("border-b");
  });
});
