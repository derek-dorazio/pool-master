import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox, FormField, Input, PasswordInput, Select, Textarea } from "./form-field";

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

  it("pool-master-q8h: renders checkbox controls without text-input styling", () => {
    render(<Checkbox aria-label="Enabled" />);

    const checkbox = screen.getByLabelText("Enabled");
    expect(checkbox).toHaveAttribute("type", "checkbox");
    expect(checkbox).toHaveClass("h-4");
    expect(checkbox).not.toHaveClass("w-full");
    expect(checkbox).not.toHaveClass("px-4");
  });

  it("starts a password input hidden, and its Show password button reveals and re-hides only its own field", () => {
    render(
      <>
        <FormField label="Password">
          <PasswordInput />
        </FormField>
        <FormField label="Confirm password">
          <PasswordInput />
        </FormField>
      </>,
    );

    const password = screen.getByLabelText("Password");
    const confirm = screen.getByLabelText("Confirm password");
    const [passwordToggle] = screen.getAllByRole("button", { name: "Show password" });

    expect(password).toHaveAttribute("type", "password");
    expect(passwordToggle).toHaveAttribute("aria-pressed", "false");
    expect(passwordToggle).toHaveAttribute("aria-controls", password.id);

    fireEvent.click(passwordToggle);
    expect(password).toHaveAttribute("type", "text");
    expect(confirm).toHaveAttribute("type", "password");
    expect(passwordToggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(passwordToggle);
    expect(password).toHaveAttribute("type", "password");
  });

  it("keeps the field's error wiring on a password input and disables its toggle with the field", () => {
    render(
      <FormField error="Password is required" id="pw" label="Password">
        <PasswordInput disabled />
      </FormField>,
    );

    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("id", "pw");
    expect(password).toHaveAttribute("aria-describedby", "pw-error");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Show password" })).toBeDisabled();
  });

  it("toggles a password input inside a form without submitting the form", () => {
    let submitCount = 0;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitCount += 1;
        }}
      >
        <PasswordInput aria-label="Password" />
      </form>,
    );

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("type", "button");

    fireEvent.click(toggle);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    expect(submitCount).toBe(0);
  });
});
