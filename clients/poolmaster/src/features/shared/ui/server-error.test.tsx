import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/errors";
import { ServerErrorBar } from "./server-error";

describe("ServerErrorBar", () => {
  it("renders the error code's display string, not the backend's own message, inside an alert", () => {
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
      "This account still belongs to leagues. Remove it from them before deleting it.",
    );
    expect(screen.queryByText("Account cannot be deleted because it still owns a team.")).not.toBeInTheDocument();
  });

  it("shows the screen's context wording for an error code, with its placeholder values, and calls onRetry when Try again is clicked", () => {
    const onRetry = vi.fn();

    render(
      <ServerErrorBar
        context="leagueYear"
        values={{ sportLeagueName: "PGA Tour", events: "tournaments", year: 2027 }}
        error={
          new ApiError({
            error: {
              code: "EVENT_YEAR_NOT_EMPTY",
              message: "Sport league sl-1 already has events in 2027",
            },
          })
        }
        onRetry={onRetry}
        title="Sync failed"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Sync failed");
    expect(screen.getByText("PGA Tour already has tournaments in 2027.")).toBeInTheDocument();
    expect(screen.queryByText("Sport league sl-1 already has events in 2027")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the fallback copy when there is no error to read a message from", () => {
    render(<ServerErrorBar error={null} fallback="We could not load this information right now." />);

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load this information right now.");
  });
});
