import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AdminAreaLayout, LeagueMenu, type NavMenuItem } from "./nav-menus";

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
