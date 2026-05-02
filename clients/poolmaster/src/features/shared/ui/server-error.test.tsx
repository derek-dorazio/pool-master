import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServerErrorBar } from "./server-error";

describe("pool-master-pjr.14: ServerErrorBar", () => {
  it("renders user-safe API error messages with alert semantics", () => {
    render(
      <ServerErrorBar
        error={{
          error: {
            code: "ACCOUNT_DELETE_DEPENDENCIES_EXIST",
            message: "Account cannot be deleted because it still owns a team.",
          },
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Account cannot be deleted because it still owns a team.",
    );
  });

  it("supports code-specific messages, retry actions, and debug details", () => {
    const onRetry = vi.fn();

    render(
      <ServerErrorBar
        codeMessages={{
          SYNC_PROVIDER_TIMEOUT: "The provider did not respond. Try again soon.",
        }}
        error={{
          error: {
            code: "SYNC_PROVIDER_TIMEOUT",
            detail: "provider request exceeded 5000ms",
            requestId: "req-123",
          },
          status: 504,
        }}
        includeDebugDetails
        onRetry={onRetry}
        title="Sync failed"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Sync failed");
    expect(screen.getByText("The provider did not respond. Try again soon.")).toBeInTheDocument();
    expect(screen.getByText("Request ID:")).toBeInTheDocument();
    expect(screen.getByText("req-123")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
