import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { EmptyState, ErrorState, LoadingState } from "./state";

describe("pool-master-3lo.7: shared page state primitives", () => {
  it("rule: renders loading copy in a shared state tile", () => {
    render(<LoadingState body="Loading contests..." />);

    expect(screen.getByText("Loading contests...")).toBeInTheDocument();
  });

  it("rule: renders error and empty states with optional actions", () => {
    render(
      <>
        <ErrorState body="Could not load users." title="Failed" />
        <EmptyState action={<Button>Refresh</Button>} body="No rows found." />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Failed" })).toBeInTheDocument();
    expect(screen.getByText("No rows found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });
});
