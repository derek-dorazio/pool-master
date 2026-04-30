import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { NotificationCard, Toast, ToastProvider, ToastViewport } from "./toast";

describe("pool-master-3lo.15: shared Toast and Notification primitives", () => {
  it("rule: renders toast content inside the shared provider", () => {
    render(
      <ToastProvider>
        <Toast description="The profile was updated." open title="Saved" />
        <ToastViewport />
      </ToastProvider>,
    );

    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("The profile was updated.")).toBeInTheDocument();
  });

  it("rule: renders notification cards with unread affordance and actions", () => {
    render(
      <NotificationCard
        action={<Button variant="secondary">Open</Button>}
        body="You have a new league invitation."
        title="Invitation"
      />,
    );

    expect(screen.getByRole("article")).toHaveTextContent("Invitation");
    expect(screen.getByLabelText("Unread")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });
});
