import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ActionModal,
  ConfirmationModal,
  FormModal,
  PickerModal,
  ReadOnlyDetailModal,
  WizardModal,
} from "./modal-templates";

describe("pool-master-3ew: shared modal templates", () => {
  it("pool-master-3ew.7: renders form modal actions and pending save state", () => {
    const handleCancel = vi.fn();
    const handleSave = vi.fn();

    render(
      <FormModal
        isPending
        onCancel={handleCancel}
        onOpenChange={vi.fn()}
        onSave={handleSave}
        open
        pendingLabel="Saving..."
        saveLabel="Save profile"
        testId="form-modal"
        title="Edit profile"
      >
        <input aria-label="Display name" />
      </FormModal>,
    );

    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("pool-master-3ew.8: gates confirmation on exact typed input", () => {
    const handleConfirm = vi.fn();

    render(
      <ConfirmationModal
        confirmationInput={{
          expectedValue: "MATHWORKS",
          label: "League code",
          onChange: vi.fn(),
          testId: "confirm-code",
          value: "MATH",
        }}
        confirmLabel="Delete league"
        description="This permanently deletes the league."
        onCancel={vi.fn()}
        onConfirm={handleConfirm}
        onOpenChange={vi.fn()}
        open
        testId="confirmation-modal"
        title="Delete league"
        tone="danger"
      />,
    );

    expect(screen.getByTestId("confirm-code")).toHaveValue("MATH");
    expect(
      screen.getByRole("button", { name: "Delete league" }),
    ).toBeDisabled();
  });

  it("pool-master-3ew.9: renders action modal sections and footer actions", () => {
    const handleClose = vi.fn();

    render(
      <ActionModal
        footer={
          <button onClick={handleClose} type="button">
            Done
          </button>
        }
        onCancel={vi.fn()}
        onOpenChange={vi.fn()}
        open
        sections={[
          {
            key: "invite",
            title: "Invite Members",
            body: <input aria-label="Invite email" />,
          },
        ]}
        title="League actions"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Invite Members" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Invite email")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("pool-master-3ew.10: renders picker items with selected state and apply", () => {
    const handleSelect = vi.fn();
    const handleApply = vi.fn();

    render(
      <PickerModal
        getItemLabel={(item) => item.label}
        items={[
          { id: "ocean", label: "Ocean" },
          { id: "forest", label: "Forest" },
        ]}
        onApply={handleApply}
        onCancel={vi.fn()}
        onOpenChange={vi.fn()}
        onSelect={handleSelect}
        open
        selectedId="ocean"
        title="Choose icon"
      />,
    );

    expect(screen.getByTestId("picker-modal-item-ocean")).toHaveTextContent(
      "Selected",
    );
    fireEvent.click(screen.getByTestId("picker-modal-item-forest"));
    expect(handleSelect).toHaveBeenCalledWith({ id: "forest", label: "Forest" });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(handleApply).toHaveBeenCalledTimes(1);
  });

  it("pool-master-3ew.11: renders read-only detail metadata and copy action", () => {
    const handleCopy = vi.fn();

    render(
      <ReadOnlyDetailModal
        detailContent={<pre>{"{ \"status\": \"COMPLETED\" }"}</pre>}
        details={[{ label: "Status", value: "Completed" }]}
        onCancel={vi.fn()}
        onCopy={handleCopy}
        onOpenChange={vi.fn()}
        open
        title="Sync payload"
      />,
    );

    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    expect(handleCopy).toHaveBeenCalledTimes(1);
  });

  it("pool-master-3ew.12: renders wizard progress and next-step action", () => {
    const handleNext = vi.fn();

    render(
      <WizardModal
        currentStepIndex={0}
        onCancel={vi.fn()}
        onNext={handleNext}
        onOpenChange={vi.fn()}
        open
        steps={[
          { id: "details", label: "Details" },
          { id: "review", label: "Review" },
        ]}
        title="Create contest"
      >
        <p>Contest details</p>
      </WizardModal>,
    );

    expect(screen.getByText("1. Details")).toBeInTheDocument();
    expect(screen.getByText("2. Review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(handleNext).toHaveBeenCalledTimes(1);
  });
});
