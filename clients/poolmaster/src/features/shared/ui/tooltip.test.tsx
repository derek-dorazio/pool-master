import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { HelpText, Tooltip } from "./tooltip";

describe("pool-master-3lo.17: shared Tooltip and HelpText primitives", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      disconnect() {}
      observe() {}
      unobserve() {}
    }

    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverMock,
    });
  });

  it("rule: renders tooltip content when opened by caller state", () => {
    render(
      <Tooltip content="Extra details" defaultOpen>
        <button type="button">Help</button>
      </Tooltip>,
    );

    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Extra details");
  });

  it("rule: renders help text that can describe form controls", () => {
    render(<HelpText id="field-help">Use your public display name.</HelpText>);

    expect(screen.getByText("Use your public display name.")).toHaveAttribute(
      "id",
      "field-help",
    );
  });
});
