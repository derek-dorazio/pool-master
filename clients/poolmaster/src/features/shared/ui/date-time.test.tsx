import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DateDisplay, DateTimeField, toDateTimeLocalValue } from "./date-time";

describe("pool-master-3lo.18: shared DateTimeField and DateDisplay primitives", () => {
  it("rule: formats valid dates and uses a fallback for missing dates", () => {
    render(
      <>
        <DateDisplay value="2026-04-30T12:30:00.000Z" />
        <DateDisplay value={null} />
      </>,
    );

    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("rule: renders datetime-local inputs and converts ISO values", () => {
    const value = toDateTimeLocalValue("2026-04-30T12:30:00.000Z");

    render(
      <DateTimeField
        aria-label="Starts at"
        onChange={() => undefined}
        value={value}
      />,
    );

    expect(screen.getByLabelText("Starts at")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(screen.getByLabelText("Starts at")).toHaveValue(value);
  });
});
