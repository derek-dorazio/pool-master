import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ActionList, ActionTile } from "./action-list";

describe("pool-master-3lo.11: shared ActionList and ActionTile primitives", () => {
  it("rule: renders link and button action tiles", () => {
    const handleClick = vi.fn();

    render(
      <MemoryRouter>
        <ActionList>
          <ActionTile label="Profile" to="/users/user-1" />
          <ActionTile label="Log out" onClick={handleClick} />
        </ActionList>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/users/user-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
