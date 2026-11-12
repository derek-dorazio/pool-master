import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricGrid, MetricTile } from "./metric-grid";

describe("MetricGrid", () => {
  it("shows each metric tile's label and its value in the large figure size", () => {
    render(
      <MetricGrid>
        <MetricTile label="Active" value="3" />
      </MetricGrid>,
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("3")).toHaveClass("text-lg");
  });
});
