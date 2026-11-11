import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PageTabs } from "./page-tabs";
import { Tabs, TabsContent } from "./tabs";

describe("PageTabs", () => {
  it("draws route-backed views as links and marks the open one as the current page", () => {
    render(
      <MemoryRouter>
        <PageTabs
          aria-label="Contests to show"
          items={[
            { isActive: true, label: "Current", testId: "tab-current", to: "/contests" },
            { isActive: false, label: "Past", testId: "tab-past", to: "/contests/past" },
          ]}
          variant="link"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Contests to show" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Current" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Current" })).toHaveClass("border-selected");
    expect(screen.getByRole("link", { name: "Past" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Past" })).toHaveAttribute("href", "/contests/past");
  });

  it("shows a view's count after its name, so it reads as part of the tab's name", () => {
    render(
      <MemoryRouter>
        <PageTabs
          aria-label="Contests to show"
          items={[{ count: 3, isActive: true, label: "Current", to: "/contests" }]}
          variant="link"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Current 3" })).toBeInTheDocument();
  });

  it("switches state-backed views as Radix tabs, telling the page which one was chosen", async () => {
    const onValueChange = vi.fn();
    render(
      <Tabs onValueChange={onValueChange} value="active">
        <PageTabs
          aria-label="Contests to show"
          items={[
            { count: 2, label: "Active", value: "active" },
            { label: "History", value: "history" },
          ]}
          variant="state"
        />
        <TabsContent value="active">Active contests</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole("tablist", { name: "Contests to show" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Active 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Active contests");

    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(onValueChange).toHaveBeenCalledWith("history");
  });

  it("moves between state-backed tabs with the arrow keys", async () => {
    render(
      <Tabs defaultValue="active">
        <PageTabs
          aria-label="Contests to show"
          items={[
            { label: "Active", value: "active" },
            { label: "History", value: "history" },
          ]}
          variant="state"
        />
      </Tabs>,
    );

    await userEvent.tab();
    expect(screen.getByRole("tab", { name: "Active" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "History" })).toHaveFocus();
  });

  it("shows a visible focus ring on every tab, inset so the scrolling row never clips it", () => {
    render(
      <MemoryRouter>
        <PageTabs aria-label="Views" items={[{ isActive: false, label: "Past", to: "/past" }]} variant="link" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Past" })).toHaveClass("focus-visible:ring-2", "focus-visible:ring-inset");
  });

  it("lets the row scroll sideways on a phone with a faded right edge", () => {
    render(
      <MemoryRouter>
        <PageTabs aria-label="Views" items={[{ isActive: true, label: "Championship", to: "/c" }]} variant="link" />
      </MemoryRouter>,
    );

    const row = screen.getByRole("navigation", { name: "Views" });
    expect(row).toHaveClass("overflow-x-auto");
    expect(row).toHaveClass("max-sm:[mask-image:linear-gradient(to_right,black_85%,transparent)]");
  });
});
