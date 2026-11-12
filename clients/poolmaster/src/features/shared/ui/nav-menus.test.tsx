import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { resizeAll } from "@/test/resize-observer";
import { installScrollRowLayout } from "@/test/scroll-row-layout";
import { AdminAreaLayout, LeagueMenu, type NavMenuItem, ToolsArea } from "./nav-menus";

const leagueItems: NavMenuItem[] = [
  { isActive: true, label: "Home", testId: "menu-home", to: "/leagues/l1" },
  { isActive: false, label: "Contests", testId: "menu-contests", to: "/leagues/l1/contests" },
  { isActive: false, label: "Members", testId: "menu-members", to: "/leagues/l1/members" },
];

describe("LeagueMenu", () => {
  it("renders each menu item as a link to its destination inside the labelled navigation", () => {
    render(
      <MemoryRouter>
        <LeagueMenu aria-label="League" items={leagueItems} />
      </MemoryRouter>,
    );

    const nav = screen.getByRole("navigation", { name: "League" });
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/leagues/l1");
    expect(within(nav).getByRole("link", { name: "Contests" })).toHaveAttribute(
      "href",
      "/leagues/l1/contests",
    );
    expect(within(nav).getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/leagues/l1/members",
    );
  });

  it("marks only the active item as the current page", () => {
    render(
      <MemoryRouter>
        <LeagueMenu aria-label="League" items={leagueItems} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Contests" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Members" })).not.toHaveAttribute("aria-current");
  });

  it("renders the trailing action inside the menu when one is given", () => {
    render(
      <MemoryRouter>
        <LeagueMenu
          action={<button type="button">Commissioner tools</button>}
          aria-label="League"
          items={leagueItems}
        />
      </MemoryRouter>,
    );

    const nav = screen.getByRole("navigation", { name: "League" });
    expect(within(nav).getByRole("button", { name: "Commissioner tools" })).toBeInTheDocument();
  });

  it("renders no action control when no action is given", () => {
    render(
      <MemoryRouter>
        <LeagueMenu aria-label="League" items={leagueItems} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("LeagueMenu on a phone too narrow for its links", () => {
  const items = (activeLabel: string): NavMenuItem[] =>
    ["Home", "Contests", "Championships", "Yours", "Members"].map((label) => ({
      isActive: label === activeLabel,
      label,
      testId: `menu-${label}`,
      to: `/${label}`,
    }));

  it("scrolls the current page's link fully into view on open and when the page changes", async () => {
    // A 250px row of five 100px links: Members (400-500) starts well off the right edge.
    const { restore: restoreLayout } = installScrollRowLayout({ rowWidth: 250, tabWidth: 100 });
    try {
      const { rerender } = render(
        <MemoryRouter>
          <LeagueMenu aria-label="League" items={items("Members")} />
        </MemoryRouter>,
      );
      const row = screen.getByTestId("league-menu-links");
      expect(row.scrollLeft).toBe(250);
      expect(row).toHaveClass("max-sm:[mask-image:linear-gradient(to_left,black_calc(100%_-_3rem),transparent)]");

      rerender(
        <MemoryRouter>
          <LeagueMenu aria-label="League" items={items("Home")} />
        </MemoryRouter>,
      );
      await vi.waitFor(() => expect(row.scrollLeft).toBe(0));
    } finally {
      restoreLayout();
    }
  });

  it("scrolls the current page's link back into view when the links grow, as when the team's name loads", () => {
    const { restore: restoreLayout, setLayout } = installScrollRowLayout({ rowWidth: 250, tabWidth: 100 });
    try {
      render(
        <MemoryRouter>
          <LeagueMenu aria-label="League" items={items("Members")} />
        </MemoryRouter>,
      );
      const row = screen.getByTestId("league-menu-links");
      expect(row.scrollLeft).toBe(250);

      // Every link widens to 120px: Members now spans 480-600 and the row can scroll to 350.
      setLayout({ rowWidth: 250, tabWidth: 120 });
      resizeAll();

      expect(row.scrollLeft).toBe(350);
    } finally {
      restoreLayout();
    }
  });
});

describe("AdminAreaLayout", () => {
  const adminItems: NavMenuItem[] = [
    { isActive: false, label: "Settings", testId: "admin-settings", to: "/leagues/l1/admin/settings" },
    { isActive: true, label: "Members", testId: "admin-members", to: "/leagues/l1/admin/members" },
  ];

  function renderLayout() {
    render(
      <MemoryRouter>
        <AdminAreaLayout
          back={{ label: "Back to league", testId: "admin-back", to: "/leagues/l1" }}
          eyebrow="Commissioner tools"
          menuItems={adminItems}
          menuLabel="Commissioner tools menu"
          title="Saturday Golf League"
        >
          <p>Members page body</p>
        </AdminAreaLayout>
      </MemoryRouter>,
    );
  }

  it("shows the area eyebrow and the title in the area header", () => {
    renderLayout();

    expect(screen.getByText("Commissioner tools")).toBeInTheDocument();
    expect(screen.getByText("Saturday Golf League")).toBeInTheDocument();
  });

  it("renders a back link to the given destination", () => {
    renderLayout();

    expect(screen.getByRole("link", { name: "Back to league" })).toHaveAttribute(
      "href",
      "/leagues/l1",
    );
  });

  it("renders the side menu with links and marks only the active item as the current page", () => {
    renderLayout();

    const nav = screen.getByRole("navigation", { name: "Commissioner tools menu" });
    const settings = within(nav).getByRole("link", { name: "Settings" });
    const members = within(nav).getByRole("link", { name: "Members" });
    expect(settings).toHaveAttribute("href", "/leagues/l1/admin/settings");
    expect(settings).not.toHaveAttribute("aria-current");
    expect(members).toHaveAttribute("href", "/leagues/l1/admin/members");
    expect(members).toHaveAttribute("aria-current", "page");
  });

  it("renders its children as the page content", () => {
    renderLayout();

    expect(screen.getByText("Members page body")).toBeInTheDocument();
  });
});

describe("ToolsArea", () => {
  function renderArea() {
    render(
      <MemoryRouter>
        <ToolsArea
          back={{ label: "Back to league", testId: "tools-back", to: "/leagues/l1" }}
          eyebrow="Commissioner tools"
          tabs={[
            { isActive: false, label: "Settings", testId: "tools-settings", to: "/leagues/l1/admin" },
            { isActive: true, label: "Members", testId: "tools-members", to: "/leagues/l1/admin/teams" },
          ]}
          tabsLabel="Commissioner tools"
          testId="tools"
          title="Saturday Golf League"
        >
          <p>Members page body</p>
        </ToolsArea>
      </MemoryRouter>,
    );
  }

  it("names the area in gold and what it acts on in one slim band, with a plain link back", () => {
    renderArea();

    const band = screen.getByTestId("tools-band");
    expect(within(band).getByText("Commissioner tools")).toHaveClass("text-primary");
    expect(within(band).getByText("Saturday Golf League")).toBeVisible();
    expect(within(band).getByRole("link", { name: "Back to league" })).toHaveAttribute("href", "/leagues/l1");
  });

  it("shows the tools as one row of tab links, marking only the open tool as the current page", () => {
    renderArea();

    const tabs = screen.getByRole("navigation", { name: "Commissioner tools" });
    expect(within(tabs).getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
    expect(within(tabs).getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
  });

  it("renders the page below the band and tabs", () => {
    renderArea();

    expect(screen.getByText("Members page body")).toBeVisible();
  });
});
