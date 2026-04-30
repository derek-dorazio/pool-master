import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DefinitionList, MetricGrid, MetricTile } from "./metric-grid";

describe("pool-master-3lo.8: shared metric and definition primitives", () => {
  it("rule: renders metric tiles for page summaries", () => {
    render(
      <MetricGrid>
        <MetricTile label="Active" value="3" />
      </MetricGrid>,
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("3")).toHaveClass("text-lg");
  });

  it("rule: renders definition lists for compact details", () => {
    render(<DefinitionList items={[{ label: "Status", value: "Open" }]} />);

    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Open")).toHaveClass("text-foreground");
  });
});
