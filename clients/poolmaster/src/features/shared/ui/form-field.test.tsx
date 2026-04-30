import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormField, Input, Select, Textarea } from "./form-field";

describe("pool-master-3lo.4: shared form field primitives", () => {
  it("rule: associates labels, helper text, and errors with form controls", () => {
    render(
      <FormField
        error="League name is required"
        helperText="Shown to league members."
        id="league-name"
        label="League name"
      >
        <Input id="league-name" />
      </FormField>,
    );

    const input = screen.getByLabelText("League name");

    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute(
      "aria-describedby",
      "league-name-helper league-name-error",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Shown to league members.")).toBeInTheDocument();
    expect(screen.getByText("League name is required")).toHaveClass(
      "text-destructive",
    );
  });

  it("rule: shares control styling across input, select, and textarea", () => {
    render(
      <>
        <Input aria-label="Name" />
        <Select aria-label="Lifecycle" />
        <Textarea aria-label="Description" />
      </>,
    );

    expect(screen.getByLabelText("Name")).toHaveClass("rounded-2xl");
    expect(screen.getByLabelText("Lifecycle")).toHaveClass("rounded-2xl");
    expect(screen.getByLabelText("Description")).toHaveClass("rounded-2xl");
  });
});
