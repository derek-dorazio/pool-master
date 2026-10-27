import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Button, LinkButton } from "./button";

describe("pool-master-3lo.1: shared Button primitives", () => {
  it("rule: renders semantic button variants without losing native button behavior", () => {
    render(<Button variant="danger">Delete</Button>);

    const button = screen.getByRole("button", { name: "Delete" });

    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("text-destructive");
  });

  it("sets button text in uppercase with the theme button spacing, and a caller can turn it back to normal case", () => {
    render(
      <>
        <Button>Create contest</Button>
        <Button className="normal-case tracking-normal">Alpha Squad</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Create contest" })).toHaveClass("uppercase", "tracking-button");
    expect(screen.getByRole("button", { name: "Alpha Squad" })).toHaveClass("normal-case", "tracking-normal");
    expect(screen.getByRole("button", { name: "Alpha Squad" })).not.toHaveClass("uppercase");
    expect(screen.getByRole("button", { name: "Alpha Squad" })).not.toHaveClass("tracking-button");
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
