import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamLine } from "./team-line";

describe("TeamLine", () => {
  it("marks a right pick with a check and no strike", () => {
    render(<TeamLine mark="right" name="Auburn" seed={1} testId="line" />);

    expect(screen.getByTestId("line")).toHaveAttribute("data-mark", "right");
    expect(screen.getByLabelText("Right")).toBeInTheDocument();
    expect(screen.getByText("Auburn")).not.toHaveClass("line-through");
  });

  it("strikes a wrong pick through with a cross and shows the team that really won in grey", () => {
    render(<TeamLine actualName="UC San Diego" mark="wrong" name="Michigan" seed={5} testId="line" />);

    expect(screen.getByText("Michigan")).toHaveClass("line-through");
    expect(screen.getByLabelText("Wrong")).toBeInTheDocument();
    expect(screen.getByText("UC San Diego")).toHaveClass("text-muted-foreground");
  });

  it("leaves a game not played yet plain: no check, no cross, no other team", () => {
    render(<TeamLine actualName="Somebody" name="Duke" seed={1} testId="line" />);

    expect(screen.queryByLabelText("Right")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Wrong")).not.toBeInTheDocument();
    expect(screen.queryByText("Somebody")).not.toBeInTheDocument();
  });

  it("picks the team when tapped, and does nothing when tapped again once it is the pick", () => {
    const onPick = vi.fn();
    const { rerender } = render(<TeamLine name="Duke" onPick={onPick} testId="line" />);

    fireEvent.click(screen.getByRole("button", { name: /Duke/ }));
    expect(onPick).toHaveBeenCalledTimes(1);

    rerender(<TeamLine isPicked name="Duke" onPick={onPick} testId="line" />);
    expect(screen.getByRole("button", { name: /Duke/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Duke/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("draws an open line as a dashed placeholder that cannot be picked, with no seed", () => {
    render(<TeamLine isOpen name="Sweet 16 winner" onPick={vi.fn()} seed={3} testId="line" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("line")).toHaveClass("border-dashed");
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("puts the seed after the name on the right half of a bracket", () => {
    render(<TeamLine isMirrored name="Duke" seed={1} testId="line" />);

    expect(screen.getByTestId("line")).toHaveClass("flex-row-reverse");
  });
});
