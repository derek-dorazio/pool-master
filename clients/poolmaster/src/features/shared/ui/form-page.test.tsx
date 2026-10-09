import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { FormPage } from "./form-page";

type FormPageProps = ComponentProps<typeof FormPage>;

function renderFormPage(overrides: Partial<FormPageProps> = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn((event: { preventDefault: () => void }) => {
    event.preventDefault();
  });
  render(
    <MemoryRouter>
      <FormPage
        cancelTo="/leagues/l1/admin/settings"
        isPending={false}
        onSubmit={onSubmit}
        pendingLabel="Saving…"
        submitLabel="Save"
        title="Edit league"
        {...overrides}
      >
        <label>
          League name
          <input defaultValue="Saturday Golf League" />
        </label>
      </FormPage>
    </MemoryRouter>,
  );
  return { onSubmit };
}

describe("FormPage", () => {
  it("shows its title as a heading and renders its fields", () => {
    renderFormPage({ description: "Change how the league appears." });

    expect(screen.getByRole("heading", { level: 2, name: "Edit league" })).toBeInTheDocument();
    expect(screen.getByText("Change how the league appears.")).toBeInTheDocument();
    expect(screen.getByLabelText("League name")).toHaveValue("Saturday Golf League");
  });

  it("submits the form through onSubmit when Save is clicked", () => {
    const { onSubmit } = renderFormPage();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows the pending label and disables submit while the save is pending", () => {
    renderFormPage({ isPending: true });

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("renders Cancel as a link back to cancelTo", () => {
    renderFormPage();

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/leagues/l1/admin/settings",
    );
  });

  it("marks Cancel as disabled while the save is pending", () => {
    renderFormPage({ isPending: true });

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the error message as an alert when the save fails", () => {
    renderFormPage({ errorMessage: "That name is already taken." });

    expect(screen.getByRole("alert")).toHaveTextContent("That name is already taken.");
  });

  it("shows no alert when there is no error message", () => {
    renderFormPage({ errorMessage: null });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables submit and does not submit when isSubmitDisabled is set", () => {
    const { onSubmit } = renderFormPage({ isSubmitDisabled: true });

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
