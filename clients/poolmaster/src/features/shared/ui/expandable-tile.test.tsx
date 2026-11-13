import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ExpandableTile } from "./expandable-tile";

function Harness({ withAction = false }: { withAction?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <ExpandableTile actions={withAction ? <a href="/create">+ Create</a> : undefined} face={<span>Squares</span>} isOpen={isOpen} onToggle={() => setIsOpen((open) => !open)} testId="format">
      <p>Pick a square.</p>
    </ExpandableTile>
  );
}

describe("ExpandableTile", () => {
  it("shows only its face while closed, and says it is collapsed", () => {
    render(<Harness />);

    expect(screen.getByTestId("format-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Pick a square.")).not.toBeInTheDocument();
  });

  it("opens to its details across the whole row when its face is pressed, and closes again", () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId("format-toggle"));
    expect(screen.getByTestId("format-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("format-details")).toHaveTextContent("Pick a square.");
    expect(screen.getByTestId("format")).toHaveClass("col-span-full", "border-primary");

    fireEvent.click(screen.getByTestId("format-toggle"));
    expect(screen.queryByTestId("format-details")).not.toBeInTheDocument();
  });

  it("puts its actions on their own row beside the face's button, not inside it, and only while closed", () => {
    render(<Harness withAction />);

    const create = screen.getByRole("link", { name: "+ Create" });
    expect(screen.getByTestId("format-actions")).toContainElement(create);
    expect(screen.getByTestId("format-toggle")).not.toContainElement(create);

    fireEvent.click(screen.getByTestId("format-toggle"));
    expect(screen.queryByTestId("format-actions")).not.toBeInTheDocument();
  });

  it("draws no actions row with no actions", () => {
    render(<Harness />);

    expect(screen.queryByTestId("format-actions")).not.toBeInTheDocument();
  });
});
