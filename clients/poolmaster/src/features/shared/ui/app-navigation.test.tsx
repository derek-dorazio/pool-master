import { fireEvent, render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppIconActionButton, AppNavigationMenu } from "./app-navigation";

describe("pool-master-dn4.5: shared app navigation primitives", () => {
  it("renders visible grouped menu items with active route state", () => {
    render(
      <MemoryRouter>
        <AppNavigationMenu
          items={[
            {
              isActive: true,
              label: "League Details",
              testId: "league-details",
              to: "/league/ABC",
            },
            {
              hidden: true,
              label: "Hidden Create Contest",
              testId: "create-contest",
              to: "/league/ABC/contests/new",
            },
          ]}
          label="League"
          triggerTestId="league-menu-trigger"
        />
      </MemoryRouter>,
    );

    fireEvent.pointerDown(screen.getByTestId("league-menu-trigger"));

    expect(screen.getByTestId("league-details")).toHaveAttribute("href", "/league/ABC");
    expect(screen.getByTestId("league-details")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("create-contest")).not.toBeInTheDocument();
  });

  it("supports disabled trigger and item state", () => {
    render(
      <MemoryRouter>
        <>
          <AppNavigationMenu
            disabled
            items={[]}
            label="Disabled My Team"
            triggerTestId="disabled-my-team-menu-trigger"
          />
          <AppNavigationMenu
            items={[
              {
                disabled: true,
                label: "Team Details",
                testId: "team-details",
                to: "/league/ABC/team",
              },
            ]}
            label="My Team"
            triggerTestId="my-team-menu-trigger"
          />
        </>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("disabled-my-team-menu-trigger")).toBeDisabled();

    fireEvent.pointerDown(screen.getByTestId("my-team-menu-trigger"));
    expect(screen.getByTestId("team-details")).toHaveClass("pointer-events-none");
  });

  it("notifies callers when an item is selected", () => {
    const handleSelect = vi.fn();

    render(
      <MemoryRouter>
        <AppNavigationMenu
          items={[
            {
              label: "My Contests",
              testId: "my-contests",
              to: "/league/ABC/contests?filter=my-entries",
            },
          ]}
          label="My Team"
          onItemSelect={handleSelect}
          triggerTestId="my-team-menu-trigger"
        />
      </MemoryRouter>,
    );

    fireEvent.pointerDown(screen.getByTestId("my-team-menu-trigger"));
    fireEvent.click(screen.getByTestId("my-contests"));

    expect(handleSelect).toHaveBeenCalledTimes(1);
  });

  it("renders compact icon action buttons with accessible labels", () => {
    render(
      <AppIconActionButton
        data-testid="notifications"
        disabled
        icon={<Inbox aria-hidden size={18} />}
        label="Notifications"
      />,
    );

    expect(screen.getByTestId("notifications")).toHaveAttribute("aria-label", "Notifications");
    expect(screen.getByTestId("notifications")).toBeDisabled();
  });
});
