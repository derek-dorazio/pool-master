import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installScrollRowLayout } from "@/test/scroll-row-layout";
import { ViewFilter } from "./view-filter";

const OPTIONS = [
  { count: 3, label: "Pending", testId: "view-pending", value: "pending" },
  { count: 1, label: "Expired", testId: "view-expired", value: "expired" },
];

describe("ViewFilter", () => {
  it("offers the views as one named radio group, each named with its count, and marks the chosen one", () => {
    render(<ViewFilter aria-label="Invites to show" onChange={() => undefined} options={OPTIONS} value="pending" />);

    expect(screen.getByRole("radiogroup", { name: "Invites to show" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Pending 3" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Pending 3" })).toHaveClass("border-selected");
    expect(screen.getByRole("radio", { name: "Expired 1" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Expired 1" })).toHaveClass("border-transparent");
  });

  it("names a view without a count by its label alone", () => {
    render(<ViewFilter aria-label="Contests to show" onChange={() => undefined} options={[{ label: "History", value: "history" }]} value="history" />);

    expect(screen.getByRole("radio", { name: "History" })).toBeChecked();
  });

  it("hands the page the view that was picked", async () => {
    const onChange = vi.fn();
    render(<ViewFilter aria-label="Invites to show" onChange={onChange} options={OPTIONS} value="pending" />);

    await userEvent.click(screen.getByTestId("view-expired"));

    expect(onChange).toHaveBeenCalledWith("expired");
  });

  it("shows a visible focus ring on every view, inset so the scrolling row never clips it", () => {
    render(<ViewFilter aria-label="Invites to show" onChange={() => undefined} options={OPTIONS} value="pending" />);

    expect(screen.getByRole("radio", { name: "Expired 1" })).toHaveClass("focus-visible:ring-2", "focus-visible:ring-inset");
  });
});

describe("ViewFilter from the keyboard", () => {
  function Views() {
    const [value, setValue] = useState("pending");
    return <ViewFilter aria-label="Invites to show" onChange={setValue} options={OPTIONS} value={value} />;
  }

  it("is one Tab stop on the chosen view, and the arrow keys move to and pick the next view", async () => {
    render(<Views />);

    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Pending 3" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Expired 1" })).toHaveAttribute("tabindex", "-1");

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Expired 1" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Expired 1" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Pending 3" })).toHaveAttribute("tabindex", "-1");
  });

  it("leaves other keys to the page", async () => {
    const onChange = vi.fn();
    render(<ViewFilter aria-label="Invites to show" onChange={onChange} options={OPTIONS} value="pending" />);

    await userEvent.tab();
    await userEvent.keyboard("a");
    expect(onChange).not.toHaveBeenCalled();
  });
});

// A phone-width row: 250px wide, four 100px views, so the last one and a half sit off the right edge.
describe("ViewFilter on a row too narrow for its views", () => {
  let restoreLayout: () => void;
  beforeEach(() => {
    restoreLayout = installScrollRowLayout({ rowWidth: 250, tabWidth: 100 }).restore;
  });
  afterEach(() => restoreLayout());

  it("opens scrolled so a chosen view at the end of the row is fully in view", () => {
    render(
      <ViewFilter
        aria-label="Views"
        onChange={() => undefined}
        options={["a", "b", "c", "d"].map((value) => ({ label: value.toUpperCase(), value }))}
        value="d"
      />,
    );

    // D spans 300-400; a 250px row scrolled to its end shows 150-400.
    expect(screen.getByRole("radiogroup", { name: "Views" }).scrollLeft).toBe(150);
  });
});
