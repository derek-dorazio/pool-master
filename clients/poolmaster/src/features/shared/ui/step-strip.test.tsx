import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StepStrip } from "./step-strip";

describe("StepStrip", () => {
  it("lists the steps in order, each with its numeral, its title as a heading and its small picture", () => {
    render(
      <StepStrip
        steps={[
          { title: "Start a league", picture: <span data-testid="picture-league" /> },
          { title: "Pick a contest" },
        ]}
        testId="steps"
      />,
    );

    const steps = within(screen.getByTestId("steps")).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual(["1Start a league", "2Pick a contest"]);
    expect(within(steps[0]).getByRole("heading", { level: 3, name: "Start a league" })).toBeInTheDocument();
    expect(within(steps[0]).getByTestId("picture-league")).toBeInTheDocument();
  });
});
