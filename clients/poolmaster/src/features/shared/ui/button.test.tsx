import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Button, LinkButton } from "./button";

describe("pool-master-3lo.1: shared Button primitives", () => {
  it("rule: renders semantic button variants without losing native button behavior", () => {
    render(<Button variant="danger">Delete</Button>);

    const button = screen.getByRole("button", { name: "Delete" });

    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("text-destructive");
  });

  it("rule: marks loading buttons disabled for pending actions", () => {
    render(<Button isLoading>Saving</Button>);

    expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
  });

  it("rule: renders router links with shared action styling", () => {
    render(
      <MemoryRouter>
        <LinkButton to="/league/MATHWORKS">Open league</LinkButton>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Open league" })).toHaveAttribute(
      "href",
      "/league/MATHWORKS",
    );
  });
});
