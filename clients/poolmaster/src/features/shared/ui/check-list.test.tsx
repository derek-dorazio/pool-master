import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckList } from "./check-list";

const ITEMS = [
  { id: "event", isMet: true, label: "Event chosen", testId: "check-event" },
  { id: "tiers", isMet: false, label: "Tiers set", testId: "check-tiers" },
  { id: "field", isMet: true, label: "Field released", testId: "check-field" },
  { id: "close", isMet: false, label: "Entries close in the future", testId: "check-close" },
];

describe("CheckList", () => {
  it("lists what is missing first, then what is done, each group in its given order", () => {
    render(<CheckList items={ITEMS} testId="checks" />);

    const items = within(screen.getByTestId("checks")).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-testid"))).toEqual(["check-tiers", "check-close", "check-event", "check-field"]);
  });

  it("marks each item met or not for tests and says so to a screen reader", () => {
    render(<CheckList items={ITEMS} />);

    expect(screen.getByTestId("check-tiers")).toHaveAttribute("data-met", "false");
    expect(screen.getByTestId("check-tiers")).toHaveTextContent("Missing: Tiers set");
    expect(screen.getByTestId("check-event")).toHaveAttribute("data-met", "true");
    expect(screen.getByTestId("check-event")).toHaveTextContent("Done: Event chosen");
  });

  it("dims a met item's text and keeps a missing one at full contrast", () => {
    render(<CheckList items={ITEMS} />);

    expect(screen.getByText("Event chosen")).toHaveClass("text-muted-foreground");
    expect(screen.getByText("Tiers set")).toHaveClass("text-foreground");
  });

  it("takes the navy panel's text colours on the inverse surface", () => {
    render(<CheckList items={ITEMS} surface="inverse" />);

    expect(screen.getByText("Event chosen")).toHaveClass("text-on-inverse-muted");
    expect(screen.getByText("Tiers set")).toHaveClass("text-on-inverse");
  });
});
