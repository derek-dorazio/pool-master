import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { ApiError } from "@/lib/errors";
import { useLeagueContextGuard } from "./league-context-guard";

function GuardHarness({
  data,
  error,
  isError = false,
  isLoading = false,
  refetch = () => undefined,
}: {
  data?: { name: string } | null;
  error?: Error | null;
  isError?: boolean;
  isLoading?: boolean;
  refetch?: () => unknown;
}) {
  const guard = useLeagueContextGuard(
    {
      data,
      error: error ?? null,
      isError,
      isLoading,
      refetch,
    },
    { loadingBody: "Loading teams and owners..." },
  );

  if (guard.state === "blocked") {
    return guard.element;
  }

  return <div data-testid="ready-league">{guard.data.name}</div>;
}

describe("pool-master-pjr.9: league context guard", () => {
  it("rule: renders the standard league loading state", () => {
    render(
      <MemoryRouter>
        <GuardHarness isLoading />
      </MemoryRouter>,
    );

    expect(screen.getByText("Loading teams and owners...")).toBeInTheDocument();
  });

  it("rule: renders the standard league load failure with Retry and recovery navigation", () => {
    const refetch = vi.fn();
    render(
      <MemoryRouter>
        <GuardHarness isError error={new Error("missing")} refetch={refetch} />
      </MemoryRouter>,
    );

    expect(screen.getByText("We couldn't load this league.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to welcome" })).toHaveAttribute(
      "href",
      "/welcome",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("rule: offers no Retry when the viewer has no access, since reading again cannot grant it", () => {
    render(
      <MemoryRouter>
        <GuardHarness
          error={new ApiError({ error: { code: "LEAGUE_MEMBERSHIP_REQUIRED", message: "Members only." } })}
          isError
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("You do not have access to this league.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to welcome" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("rule: exposes the loaded league when context is ready", () => {
    render(
      <MemoryRouter>
        <GuardHarness data={{ name: "Mathworks" }} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("ready-league")).toHaveTextContent("Mathworks");
  });
});
