import { render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { FactList } from "./fact-list";

function StatefulValue({ testId, value }: { testId: string; value: string }) {
  const [initialValue] = useState(value);
  return <span data-testid={testId}>{initialValue}</span>;
}

describe("FactList", () => {
  it("pairs each label with its value as a description list, in the order given", () => {
    render(
      <FactList
        facts={[
          { id: "status", label: "Status", value: "Open" },
          { id: "phase", label: "Phase", value: "Live" },
        ]}
        testId="facts"
      />,
    );

    const list = screen.getByTestId("facts");
    expect(list.tagName).toBe("DL");
    expect(within(list).getAllByRole("term").map((term) => term.textContent)).toEqual(["Status", "Phase"]);
    expect(within(list).getAllByRole("definition").map((value) => value.textContent)).toEqual(["Open", "Live"]);
  });

  it("sets labels muted and values semibold with lined-up figures", () => {
    render(<FactList facts={[{ id: "points", label: "Points", value: "612.5" }]} />);

    expect(screen.getByText("Points")).toHaveClass("text-muted-foreground");
    expect(screen.getByText("612.5")).toHaveClass("font-semibold", "tabular-nums", "text-foreground");
  });

  it("sets the inline layout's value right of its label, with hairlines between pairs", () => {
    render(<FactList facts={[{ id: "a", label: "A", testId: "a-value", value: "1" }]} testId="facts" />);

    expect(screen.getByTestId("facts")).toHaveClass("divide-y");
    expect(screen.getByTestId("a-value")).toHaveClass("text-right");
  });

  it("indents the inset layout under the row that opened it", () => {
    render(<FactList facts={[{ id: "a", label: "A", value: "1" }]} layout="inset" testId="facts" />);

    expect(screen.getByTestId("facts")).toHaveClass("pl-14");
  });

  it("closes the lines up in the compact density", () => {
    render(<FactList density="compact" facts={[{ id: "a", label: "A", value: "1" }]} testId="facts" />);

    const [pair] = within(screen.getByTestId("facts")).getAllByRole("generic");
    expect(pair).toHaveClass("py-1");
  });

  it("sets the columns layout's labels in the small-caps label look over left-set values, three across from a tablet up", () => {
    render(<FactList facts={[{ id: "plan", label: "Plan", testId: "plan", value: "Pro" }]} layout="columns" testId="facts" />);

    expect(screen.getByTestId("facts")).toHaveClass("sm:grid-cols-3");
    expect(screen.getByText("Plan")).toHaveClass("uppercase");
    expect(screen.getByTestId("plan")).not.toHaveClass("text-right");
  });

  it("takes two columns when asked", () => {
    render(<FactList columns={2} facts={[{ id: "a", label: "A", value: "1" }]} layout="columns" testId="facts" />);

    expect(screen.getByTestId("facts")).toHaveClass("sm:grid-cols-2");
  });

  it("puts a fact's detail line inside its value, muted, so the value's test id reads both", () => {
    render(<FactList facts={[{ detail: "PGA Tour, NBA", id: "leagues", label: "Sports leagues", testId: "leagues", value: "2 of 3" }]} />);

    expect(screen.getByTestId("leagues")).toHaveTextContent("2 of 3PGA Tour, NBA");
    expect(screen.getByText("PGA Tour, NBA")).toHaveClass("text-muted-foreground");
  });

  it("keeps each value with its fact's identity when the facts are reordered", () => {
    const build = (order: Array<"status" | "score">) =>
      order.map((id) => ({
        id,
        label: id,
        value: <StatefulValue testId={`${id}-value`} value={id === "status" ? "Open" : "12 pts"} />,
      }));
    const { rerender } = render(<FactList facts={build(["status", "score"])} />);

    rerender(<FactList facts={build(["score", "status"])} />);

    expect(screen.getByTestId("score-value")).toHaveTextContent("12 pts");
    expect(screen.getByTestId("status-value")).toHaveTextContent("Open");
  });
});
