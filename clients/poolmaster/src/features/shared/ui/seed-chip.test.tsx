import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeedChip } from "./seed-chip";

describe("SeedChip", () => {
  it("shows the seed's number and reads it as a seed to a screen reader", () => {
    render(<SeedChip seed={12} />);

    expect(screen.getByText("12")).toBeVisible();
    expect(screen.getByText((_, element) => element?.getAttribute("data-seed") === "12")).toHaveTextContent("Seed 12");
  });
});
