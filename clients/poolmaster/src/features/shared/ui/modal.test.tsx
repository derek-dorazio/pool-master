import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Modal } from "./modal";

describe("pool-master-3lo.3: shared Modal primitive", () => {
  it("rule: renders accessible dialog structure and footer actions", async () => {
    const user = userEvent.setup();
    const handleOpenChange = vi.fn();
    const handleClose = vi.fn();

    render(
      <Modal
        description="Invite new members."
        descriptionId="invite-description"
        footer={<Button>Send invite</Button>}
        onClose={handleClose}
        onOpenChange={handleOpenChange}
        open
        title="Invite Members"
      >
        <p>Invite form</p>
      </Modal>,
    );

    expect(
      screen.getByRole("dialog", { name: "Invite Members" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Invite new members.")).toHaveAttribute(
      "id",
      "invite-description",
    );
    expect(
      screen.getByRole("button", { name: "Send invite" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close modal" }));

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("announces its description as the dialog's accessible description even when no descriptionId is passed", () => {
    render(
      <Modal description="They will leave the league." onOpenChange={() => undefined} open title="Remove owner">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog", { name: "Remove owner" })).toHaveAccessibleDescription("They will leave the league.");
  });

  it("fills a phone's screen only when asked to", () => {
    const { rerender } = render(
      <Modal onOpenChange={vi.fn()} open testId="page-modal" title="Preview">
        <p>Whole page</p>
      </Modal>,
    );
    expect(screen.getByTestId("page-modal")).not.toHaveClass("max-sm:h-dvh");

    rerender(
      <Modal isFullScreenOnPhone onOpenChange={vi.fn()} open testId="page-modal" title="Preview">
        <p>Whole page</p>
      </Modal>,
    );
    expect(screen.getByTestId("page-modal")).toHaveClass("max-sm:h-dvh");
  });
});
