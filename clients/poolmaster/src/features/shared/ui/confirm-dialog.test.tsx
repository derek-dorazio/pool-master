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

  it("keeps a type-to-confirm action disabled until the exact value is typed, then enables it", () => {
    const handleConfirm = vi.fn();
    const props = {
      confirmLabel: "Delete league",
      description: "This permanently deletes the league.",
      onCancel: vi.fn(),
      onConfirm: handleConfirm,
      onOpenChange: vi.fn(),
      open: true,
      testId: "delete-dialog",
      title: "Delete league",
      tone: "danger" as const,
    };
    const input = { expectedValue: "MATHWORKS", label: "League code", onChange: vi.fn(), testId: "confirm-code" };
    const { rerender } = render(<ConfirmDialog {...props} confirmationInput={{ ...input, value: "MATH" }} />);

    expect(screen.getByTestId("confirm-code")).toHaveValue("MATH");
    fireEvent.change(screen.getByLabelText("League code"), { target: { value: "MATHW" } });
    expect(input.onChange).toHaveBeenCalledWith("MATHW");
    expect(screen.getByRole("button", { name: "Delete league" })).toBeDisabled();

    rerender(<ConfirmDialog {...props} confirmationInput={{ ...input, value: "MATHWORKS" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete league" }));
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows a failure as a red notice above the buttons and stays open", () => {
    render(
      <ConfirmDialog
        confirmLabel="Remove"
        error="That owner could not be removed."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        open
        testId="remove-dialog"
        title="Remove owner"
        tone="danger"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("That owner could not be removed.");
    expect(screen.getByTestId("remove-dialog-error")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Remove owner" })).toBeInTheDocument();
  });

  it("leaves out the description line when there is nothing to say about what will happen", () => {
    render(
      <ConfirmDialog confirmLabel="Release" onCancel={vi.fn()} onConfirm={vi.fn()} onOpenChange={vi.fn()} open title="Release the field?" />,
    );

    expect(screen.getByRole("dialog", { name: "Release the field?" })).not.toHaveAttribute("aria-describedby");
  });
});
