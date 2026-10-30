import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ListCard, ListStack } from "./list-card";

describe("pool-master-dn4.6: shared ListCard primitives", () => {
  it("rule: renders a link row card with metadata and trailing status", () => {
    render(
      <MemoryRouter>
        <ListCard
          metadata="GOLF · TIERED"
          title="Masters Pick 6"
          to="/leagues/mathworks/contests/contest-1"
          trailing={
            <>
              <div>OPEN</div>
              <div>2 entries</div>
            </>
          }
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /Masters Pick 6/i });

    expect(link).toHaveAttribute(
      "href",
      "/leagues/mathworks/contests/contest-1",
    );
    expect(screen.getByText("GOLF · TIERED")).toBeInTheDocument();
    expect(screen.getByText("OPEN")).toBeInTheDocument();
    expect(screen.getByText("2 entries")).toBeInTheDocument();
  });

  it("rule: stacks its children with even spacing", () => {
    render(
      <ListStack data-testid="list-stack">
        <p>No records yet.</p>
      </ListStack>,
    );

    expect(screen.getByTestId("list-stack")).toHaveClass("space-y-3");
  });
});
