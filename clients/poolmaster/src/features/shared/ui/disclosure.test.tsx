import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Accordion, Disclosure } from "./disclosure";

describe("pool-master-3lo.20: shared Disclosure and Accordion primitives", () => {
  it("rule: renders disclosure content behind native summary controls", () => {
    render(<Disclosure summary="Details">Hidden detail copy</Disclosure>);

    const details = screen.getByText("Details").closest("details");
    expect(details).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("Details"));
    expect(details).toHaveAttribute("open");
  });

  it("rule: renders reusable accordion item lists", () => {
    render(
      <Accordion
        items={[
          { content: "First content", id: "one", summary: "First" },
          {
            content: "Second content",
            defaultOpen: true,
            id: "two",
            summary: "Second",
          },
        ]}
      />,
    );

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(
      screen.getByText("Second content").closest("details"),
    ).toHaveAttribute("open");
  });
});
