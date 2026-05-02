import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useLeagueContextGuard } from "./league-context-guard";

function GuardHarness({
  data,
  error,
  isError = false,
  isLoading = false,
}: {
  data?: { name: string } | null;
  error?: unknown;
  isError?: boolean;
  isLoading?: boolean;
}) {
  const guard = useLeagueContextGuard(
    {
      data,
      error,
      isError,
      isLoading,
    },
    { loadingBody: "Loading teams and owners..." },
  );

  if (guard.state === "blocked") {
    return guard.element;
  }

  return <div data-testid="ready-league">{guard.league.name}</div>;
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

  it("rule: renders the standard league load failure with recovery navigation", () => {
    render(
      <MemoryRouter>
        <GuardHarness isError error={new Error("missing")} />
      </MemoryRouter>,
    );

    expect(screen.getByText("We couldn't load this league.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to welcome" })).toHaveAttribute(
      "href",
      "/welcome",
    );
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
