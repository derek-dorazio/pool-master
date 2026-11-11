import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installScrollRowLayout } from "@/test/scroll-row-layout";
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

  it("lets the row scroll sideways", () => {
    render(
      <MemoryRouter>
        <PageTabs aria-label="Views" items={[{ isActive: true, label: "Championship", to: "/c" }]} variant="link" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Views" })).toHaveClass("overflow-x-auto");
  });
});

// A phone-width row: 250px wide, four 100px tabs, so the last one and a half sit off the right edge.
describe("PageTabs on a row too narrow for its tabs", () => {
  let restoreLayout: () => void;
  beforeEach(() => {
    restoreLayout = installScrollRowLayout({ rowWidth: 250, tabWidth: 100 }).restore;
  });
  afterEach(() => restoreLayout());

  const linkTabs = (activeLabel: string) =>
    ["Championship", "Trophies", "Race", "All years"].map((label) => ({
      isActive: label === activeLabel,
      label,
      to: `/${label}`,
    }));

  it("opens scrolled so a selected tab at the end of the row is fully in view, not cut off under the fade", () => {
    render(
      <MemoryRouter>
        <PageTabs aria-label="Championships" items={linkTabs("All years")} variant="link" />
      </MemoryRouter>,
    );

    // All years spans 300-400; a 250px row scrolled to its end shows 150-400.
    expect(screen.getByRole("navigation", { name: "Championships" }).scrollLeft).toBe(150);
  });

  it("leaves the row at its start when the selected tab is already clear of the faded edge", () => {
    render(
      <MemoryRouter>
        <PageTabs aria-label="Championships" items={linkTabs("Championship")} variant="link" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Championships" }).scrollLeft).toBe(0);
  });

  it("scrolls the newly selected link tab into view when the page moves to another view", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <PageTabs aria-label="Championships" items={linkTabs("Championship")} variant="link" />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <PageTabs aria-label="Championships" items={linkTabs("Race")} variant="link" />
      </MemoryRouter>,
    );

    // Race spans 200-300; it must clear the 48px fade at the right edge: 300 - 250 + 48.
    const row = screen.getByRole("navigation", { name: "Championships" });
    await vi.waitFor(() => expect(row.scrollLeft).toBe(98));
  });

  it("scrolls a state-backed tab into view when it is chosen", async () => {
    render(
      <Tabs defaultValue="a">
        <PageTabs
          aria-label="Views"
          items={["a", "b", "c", "d"].map((value) => ({ label: value.toUpperCase(), value }))}
          variant="state"
        />
      </Tabs>,
    );
    const row = screen.getByRole("tablist", { name: "Views" });
    expect(row.scrollLeft).toBe(0);

    await userEvent.click(screen.getByRole("tab", { name: "D" }));

    await vi.waitFor(() => expect(row.scrollLeft).toBe(150));
  });

  it("fades only the right edge while more tabs sit off to the right", () => {
    render(
      <MemoryRouter>
        <PageTabs aria-label="Championships" items={linkTabs("Championship")} variant="link" />
      </MemoryRouter>,
    );

    const row = screen.getByRole("navigation", { name: "Championships" });
    expect(row).toHaveClass("max-sm:[mask-image:linear-gradient(to_right,black_calc(100%_-_3rem),transparent)]");
  });

  it("fades only the left edge once scrolled to the end, so the earlier tabs read as off to the left", () => {
    render(
      <MemoryRouter>
        <PageTabs aria-label="Championships" items={linkTabs("All years")} variant="link" />
      </MemoryRouter>,
    );

    const row = screen.getByRole("navigation", { name: "Championships" });
    expect(row).toHaveClass("max-sm:[mask-image:linear-gradient(to_left,black_calc(100%_-_3rem),transparent)]");
  });

  it("fades both edges when the row is scrolled partway, with tabs off each side", () => {
    render(
      <MemoryRouter>
        <PageTabs aria-label="Championships" items={linkTabs("Race")} variant="link" />
      </MemoryRouter>,
    );

    const row = screen.getByRole("navigation", { name: "Championships" });
    expect(row).toHaveClass(
      "max-sm:[mask-image:linear-gradient(to_right,transparent,black_3rem,black_calc(100%_-_3rem),transparent)]",
    );
  });

  it("updates the fades as the reader scrolls the row by hand", () => {
    render(
      <MemoryRouter>
        <PageTabs aria-label="Championships" items={linkTabs("Championship")} variant="link" />
      </MemoryRouter>,
    );
    const row = screen.getByRole("navigation", { name: "Championships" });

    row.scrollLeft = 150;
    fireEvent.scroll(row);

    expect(row).toHaveClass("max-sm:[mask-image:linear-gradient(to_left,black_calc(100%_-_3rem),transparent)]");
  });

  it("draws no fade when every tab fits", () => {
    render(
      <MemoryRouter>
        <PageTabs aria-label="Views" items={linkTabs("Trophies").slice(0, 2)} variant="link" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Views" })).not.toHaveClass(/mask-image/);
  });
});
