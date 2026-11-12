import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { LockedSection } from "./locked-section";

function renderLocked(props: Partial<Parameters<typeof LockedSection>[0]> = {}) {
  render(
    <MemoryRouter>
      <LockedSection plansTo="/league/BIGDAWGS/admin/plan" testId="locked" title="Event emails" {...props}>
        Included with Premium.
      </LockedSection>
    </MemoryRouter>,
  );
}

describe("LockedSection", () => {
  it("keeps the section's title as a heading, so the locked feature still shows in its place", () => {
    renderLocked();

    expect(screen.getByRole("region", { name: "Event emails" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Event emails" })).toBeInTheDocument();
  });

  it("says in one line which plan includes it", () => {
    renderLocked();

    expect(within(screen.getByTestId("locked-locked")).getByText("Included with Premium.")).toBeInTheDocument();
  });

  it("links to the plans in its footer, labelled See plans unless told otherwise", () => {
    renderLocked();

    expect(screen.getByRole("link", { name: /See plans/ })).toHaveAttribute("href", "/league/BIGDAWGS/admin/plan");
  });

  it("uses the footer label it is given", () => {
    renderLocked({ plansLabel: "Compare plans" });

    expect(screen.getByRole("link", { name: /Compare plans/ })).toBeInTheDocument();
  });
});
