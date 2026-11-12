import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormSection } from "./form-section";

describe("FormSection", () => {
  it("names its section by its title and shows the step's number in a circle, read as the step", () => {
    render(<FormSection step={2} testId="create-format" title="Format"><p>Choices</p></FormSection>);

    expect(screen.getByRole("region", { name: /^Step 2:\s*Format$/ })).toHaveTextContent("Choices");
    expect(screen.getByTestId("create-format-step")).toHaveTextContent("2");
    expect(screen.getByTestId("create-format-step")).toHaveClass("rounded-full", "bg-primary");
  });

  it("drops the number for a form that is not a sequence", () => {
    render(<FormSection testId="cup-name" title="Championship name"><p>Field</p></FormSection>);

    expect(screen.getByRole("region", { name: "Championship name" })).toBeInTheDocument();
    expect(screen.queryByTestId("cup-name-step")).not.toBeInTheDocument();
  });

  it("puts how the section works behind a (?) instead of a sentence under the title", () => {
    render(<FormSection help="Entries close at the first tee time." testId="create-event" title="Event"><p>Events</p></FormSection>);

    expect(screen.getByTestId("create-event-help")).toBeInTheDocument();
    expect(screen.queryByText("Entries close at the first tee time.")).not.toBeInTheDocument();
  });
});
