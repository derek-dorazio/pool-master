import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressIndicator, Skeleton } from "./progress";

describe("pool-master-3lo.19: shared Skeleton and ProgressIndicator primitives", () => {
  it("rule: renders skeleton placeholders without content text", () => {
    render(<Skeleton aria-label="Loading rows" lines={3} />);

    expect(screen.getByLabelText("Loading rows")).toBeInTheDocument();
  });

  it("rule: renders bounded progress values", () => {
    render(<ProgressIndicator label="Entry completion" max={12} value={18} />);

    expect(
      screen.getByRole("progressbar", { name: "Entry completion" }),
    ).toHaveAttribute("aria-valuenow", "12");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
