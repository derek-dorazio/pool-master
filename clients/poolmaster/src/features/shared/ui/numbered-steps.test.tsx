import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NumberedSteps } from "./numbered-steps";

const STEPS = [
  { title: "Start your league", body: "Name it." },
  { title: "Invite with one link", body: "Send it to the group chat." },
];

describe("NumberedSteps", () => {
  it("numbers the steps in order, each with its title and body", () => {
    render(<NumberedSteps steps={STEPS} testId="steps" />);
    const [first, second] = within(screen.getByTestId("steps")).getAllByRole("listitem");

    expect(within(first).getByText("1")).toBeInTheDocument();
    expect(within(first).getByRole("heading", { name: "Start your league" })).toBeInTheDocument();
    expect(within(second).getByText("2")).toBeInTheDocument();
    expect(within(second).getByText("Send it to the group chat.")).toBeInTheDocument();
  });

  it("sets every numeral in the one gold style", () => {
    render(<NumberedSteps steps={STEPS} />);

    expect(screen.getByText("1")).toHaveClass("text-primary", "font-display");
    expect(screen.getByText("2")).toHaveClass("text-primary", "font-display");
  });

  it("puts a step's picture in its tile when it has one", () => {
    render(<NumberedSteps steps={[{ title: "Start your league", body: "Name it.", picture: <img alt="A league being named" src="/x.png" /> }]} />);

    expect(screen.getByAltText("A league being named")).toBeInTheDocument();
  });

  it("takes the caller's layout for the list, such as a phone scroller", () => {
    render(<NumberedSteps className="grid-flow-col" steps={STEPS} testId="steps" />);

    expect(screen.getByTestId("steps")).toHaveClass("grid-flow-col");
  });
});
