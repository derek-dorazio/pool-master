import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ListCard, ListEmptyRow, ListStack } from "./list-card";

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

  it("rule: renders button row cards with actions", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(
      <>
        <ListCard onClick={handleClick} title="Clickable row" />
        <ListCard
          actions={<button type="button">Open row action</button>}
          title="Static row with action"
        />
      </>,
    );

    await user.click(screen.getByRole("button", { name: /Clickable row/i }));

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Open row action" }),
    ).toBeInTheDocument();
  });

  it("rule: renders stack and empty row treatment", () => {
    render(
      <ListStack data-testid="list-stack">
        <ListEmptyRow>No records yet.</ListEmptyRow>
      </ListStack>,
    );

    expect(screen.getByTestId("list-stack")).toHaveClass("space-y-3");
    expect(screen.getByText("No records yet.")).toHaveClass("border-dashed");
  });
});
