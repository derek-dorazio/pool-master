import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Notice } from "./notice";
import { StatusPage } from "./status-page";

describe("StatusPage", () => {
  it("shows the title as the page heading, one plain line and the action, in the shared 8px card", () => {
    render(
      <StatusPage action={<Button>Reload</Button>} body="Reload to try again." kind="error" testId="crash" title="Something went wrong" />,
    );

    const page = screen.getByRole("region", { name: "Something went wrong" });
    expect(page).toHaveClass("rounded-lg");
    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument();
    expect(within(page).getByText("Reload to try again.")).toBeInTheDocument();
    expect(within(page).getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it.each([
    ["notFound", "lucide-circle-question-mark"],
    ["error", "lucide-circle-alert"],
    ["expired", "lucide-timer"],
    ["done", "lucide-circle-check"],
    ["confirm", "lucide-info"],
  ] as const)("draws the %s symbol", (kind, iconClass) => {
    render(<StatusPage body="Line." kind={kind} testId="status" title="Title" />);

    expect(screen.getByTestId("status")).toHaveAttribute("data-kind", kind);
    expect(screen.getByTestId("status-symbol")).toHaveClass(iconClass);
  });

  it("puts extra content such as a failed try's Notice above the action, and leaves the action row out when there is none", () => {
    const { rerender } = render(
      <StatusPage action={<Button>Try again</Button>} body="Line." kind="confirm" testId="status" title="Title">
        <Notice tone="danger">That failed.</Notice>
      </StatusPage>,
    );

    const alert = screen.getByRole("alert");
    const button = screen.getByRole("button", { name: "Try again" });
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    rerender(<StatusPage body="Line." kind="expired" testId="status" title="Title" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
