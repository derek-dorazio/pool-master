import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressIndicator } from "./progress";

describe("pool-master-3lo.19: shared ProgressIndicator primitive", () => {
  it("rule: renders bounded progress values", () => {
    render(<ProgressIndicator label="Entry completion" max={12} value={18} />);

    expect(
      screen.getByRole("progressbar", { name: "Entry completion", value: { now: 12 } }),
    ).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("draws the bar in the destructive color only for the danger tone, as for spend past a cap", () => {
    const { rerender } = render(<ProgressIndicator label="Spent" max={100} value={50} />);
    const bar = () => screen.getByRole("progressbar", { name: "Spent" });
    expect(bar()).toContainHTML("bg-primary");
    expect(bar()).not.toContainHTML("bg-destructive");

    rerender(<ProgressIndicator label="Spent" max={100} tone="danger" value={120} />);
    expect(bar()).toContainHTML("bg-destructive");
  });
});
