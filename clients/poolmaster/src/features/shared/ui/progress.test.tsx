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
});
