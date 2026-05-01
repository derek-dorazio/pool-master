import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

describe("pool-master-dn4.2: shared ConfirmDialog primitive", () => {
  it("renders confirmation copy and dispatches cancel and confirm actions", () => {
    const handleCancel = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        confirmLabel="Inactivate"
        description="This action can be reversed later."
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        onOpenChange={vi.fn()}
        open
        testId="confirm-dialog"
        title="Inactivate league"
      />,
    );

    expect(screen.getByTestId("confirm-dialog")).toHaveTextContent(
      "This action can be reversed later.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(handleCancel).toHaveBeenCalledTimes(1);
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });

  it("supports pending and disabled destructive confirmations with body content", () => {
    const handleCancel = vi.fn();
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        confirmLabel="Delete"
        description="Enter the confirmation code."
        isConfirmDisabled
        isPending
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        onOpenChange={vi.fn()}
        open
        pendingLabel="Deleting..."
        testId="delete-dialog"
        title="Delete league"
        tone="danger"
      >
        <input aria-label="Confirmation code" />
      </ConfirmDialog>,
    );

    expect(screen.getByLabelText("Confirmation code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
