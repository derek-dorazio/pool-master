import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DefinitionList, MetricGrid, MetricTile } from "./metric-grid";

function StatefulDefinitionValue({
  testId,
  value,
}: {
  testId: string;
  value: string;
}) {
  const [initialValue] = useState(value);

  return <span data-testid={testId}>{initialValue}</span>;
}

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
    render(<DefinitionList items={[{ id: "status", label: "Status", value: "Open" }]} />);

    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Open")).toHaveClass("text-foreground");
  });

  it("pool-master-rop.62: keeps definition values keyed by item identity after reorder", () => {
    const buildItems = (order: Array<"status" | "score">) =>
      order.map((id) => ({
        id,
        label: id === "status" ? "Status" : "Score",
        value: (
          <StatefulDefinitionValue
            testId={`${id}-definition-value`}
            value={id === "status" ? "Open" : "12 pts"}
          />
        ),
      }));
    const { rerender } = render(
      <DefinitionList items={buildItems(["status", "score"])} />,
    );

    rerender(<DefinitionList items={buildItems(["score", "status"])} />);

    expect(screen.getByTestId("score-definition-value")).toHaveTextContent(
      "12 pts",
    );
    expect(screen.getByTestId("status-definition-value")).toHaveTextContent(
      "Open",
    );
  });
});
