import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { DetailsPeek, PeekCard } from "./details-peek";
import { ExpandableRow } from "./expandable-row";

function Row({ defaultOpen }: { defaultOpen?: boolean }) {
  return (
    <ExpandableRow defaultOpen={defaultOpen} label="Picks for Incubus 1" summary={<span>Incubus 1</span>} testId="row">
      <p>J.B. Holmes −14</p>
    </ExpandableRow>
  );
}

describe("ExpandableRow", () => {
  it("starts closed, with its breakdown hidden and aria-expanded false", () => {
    render(<Row />);

    expect(screen.getByRole("button", { name: "Picks for Incubus 1" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("J.B. Holmes −14")).not.toBeInTheDocument();
  });

  it("opens its breakdown on a click and closes it on a second click", () => {
    render(<Row />);
    const toggle = screen.getByRole("button", { name: "Picks for Incubus 1" });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("row-details")).toHaveTextContent("J.B. Holmes −14");
    expect(toggle).toHaveAttribute("aria-controls", screen.getByTestId("row-details").id);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("row-details")).not.toBeInTheDocument();
  });

  it("puts a row layout class on the clickable row only, never on its breakdown", () => {
    render(
      <ExpandableRow defaultOpen label="Picks for Incubus 1" rowClassName="sticky left-0" summary={<span>Incubus 1</span>} testId="row">
        <p>J.B. Holmes −14</p>
      </ExpandableRow>,
    );

    const row = screen.getByTestId("row-row");
    expect(within(row).getByRole("button", { name: "Picks for Incubus 1" })).toBeInTheDocument();
    expect(row).toHaveClass("sticky", "left-0");
    expect(row).not.toHaveClass("relative");
    expect(screen.getByTestId("row-details")).not.toHaveClass("sticky");
  });

  it("opens from the keyboard with Enter and with Space", async () => {
    const user = userEvent.setup();
    render(<Row />);
    const toggle = screen.getByRole("button", { name: "Picks for Incubus 1" });

    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("does not open on hover", async () => {
    const user = userEvent.setup();
    render(<Row />);

    await user.hover(screen.getByRole("button", { name: "Picks for Incubus 1" }));
    expect(screen.queryByText("J.B. Holmes −14")).not.toBeInTheDocument();
  });

  it("starts open with defaultOpen", () => {
    render(<Row defaultOpen />);

    expect(screen.getByText("J.B. Holmes −14")).toBeInTheDocument();
  });

  it("lets several rows stay open at once", () => {
    render(
      <>
        <ExpandableRow label="Row one" summary="One">one detail</ExpandableRow>
        <ExpandableRow label="Row two" summary="Two">two detail</ExpandableRow>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Row one" }));
    fireEvent.click(screen.getByRole("button", { name: "Row two" }));
    expect(screen.getByText("one detail")).toBeInTheDocument();
    expect(screen.getByText("two detail")).toBeInTheDocument();
  });

  it("a controlled row follows isOpen and reports each toggle", () => {
    const onToggle = vi.fn();
    function Controlled() {
      const [isOpen, setIsOpen] = useState(true);
      return (
        <ExpandableRow
          isOpen={isOpen}
          label="Controlled"
          onToggle={() => {
            onToggle();
            setIsOpen((open) => !open);
          }}
          summary="Summary"
          toggleTestId="controlled-toggle"
        >
          breakdown
        </ExpandableRow>
      );
    }
    render(<Controlled />);

    expect(screen.getByText("breakdown")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("controlled-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("breakdown")).not.toBeInTheDocument();
  });

  it("a button inside the summary works without toggling the row", () => {
    const onPeek = vi.fn();
    render(
      <ExpandableRow label="Row" summary={<button onClick={onPeek} type="button">About</button>}>
        detail
      </ExpandableRow>,
    );

    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(onPeek).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Row" })).toHaveAttribute("aria-expanded", "false");
  });

  it("a peek opened from the summary stays live: its callout takes clicks, not the row beneath it", () => {
    render(
      <MemoryRouter>
        <ExpandableRow
          label="Picks for Incubus 1"
          summary={(
            <span>
              Incubus 1
              <DetailsPeek label="About Incubus 1" testId="peek">
                <PeekCard facts={[{ label: "Owners", value: "Sam Lee" }]} title="Incubus" />
              </DetailsPeek>
            </span>
          )}
        >
          picks
        </ExpandableRow>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "About Incubus 1" }));
    const callout = screen.getByTestId("peek-callout");
    // The summary passes taps through to the row's toggle; the peek takes them back, callout included.
    expect(callout).toHaveClass("pointer-events-auto");
    fireEvent.click(screen.getByText("Sam Lee"));

    expect(screen.getByTestId("peek-callout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Picks for Incubus 1" })).toHaveAttribute("aria-expanded", "false");
  });
});
