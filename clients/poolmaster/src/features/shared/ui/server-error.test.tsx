import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/errors";
import { ServerErrorBar } from "./server-error";

describe("ServerErrorBar", () => {
  it("renders the backend's own message from an API error inside an alert", () => {
    render(
      <ServerErrorBar
        error={
          new ApiError({
            error: {
              code: "ACCOUNT_DELETE_DEPENDENCIES_EXIST",
              message: "Account cannot be deleted because it still owns a team.",
            },
          })
        }
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Account cannot be deleted because it still owns a team.",
    );
  });

  it("shows the codeMessages copy for a mapped error code and calls onRetry when Try again is clicked", () => {
    const onRetry = vi.fn();

    render(
      <ServerErrorBar
        codeMessages={{
          SYNC_PROVIDER_TIMEOUT: "The provider did not respond. Try again soon.",
        }}
        error={
          new ApiError({
            error: {
              code: "SYNC_PROVIDER_TIMEOUT",
              message: "provider request exceeded 5000ms",
            },
          })
        }
        onRetry={onRetry}
        title="Sync failed"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Sync failed");
    expect(screen.getByText("The provider did not respond. Try again soon.")).toBeInTheDocument();
    expect(screen.queryByText("provider request exceeded 5000ms")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the fallback copy when there is no error to read a message from", () => {
    render(<ServerErrorBar error={null} fallback="We could not load this information right now." />);

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load this information right now.");
  });
});
