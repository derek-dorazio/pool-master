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

  it("sets button text in uppercase with the theme button spacing, and the row layout turns it back to normal case", () => {
    render(
      <>
        <Button>Create contest</Button>
        <Button layout="row">Alpha Squad</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Create contest" })).toHaveClass("uppercase", "tracking-button");
    expect(screen.getByRole("button", { name: "Alpha Squad" })).toHaveClass("normal-case", "tracking-normal");
    expect(screen.getByRole("button", { name: "Alpha Squad" })).not.toHaveClass("uppercase");
    expect(screen.getByRole("button", { name: "Alpha Squad" })).not.toHaveClass("tracking-button");
  });

  it("draws a row button full width, left aligned and wrapping, growing past its size's height instead of clipping", () => {
    render(<Button layout="row">A long squad name that wraps onto a second line</Button>);

    const row = screen.getByRole("button");

    expect(row).toHaveClass("w-full", "justify-start", "text-left", "whitespace-normal", "h-auto", "min-h-12");
    expect(row).not.toHaveClass("justify-center", "h-12");
  });

  it("draws the link variant as quiet blue small caps with no box, for an action at the end of a line such as Retry", () => {
    render(<Button size="xs" variant="link">Retry</Button>);

    const button = screen.getByRole("button", { name: "Retry" });
    expect(button).toHaveClass("text-label", "text-xs", "font-bold", "uppercase");
    expect(button).not.toHaveClass("border");
  });

  it("keeps the colour of the chosen variant on a row button, so a picked row can still look pressed", () => {
    render(<Button layout="row" variant="subtle">Ravens</Button>);

    expect(screen.getByRole("button", { name: "Ravens" })).toHaveClass("bg-primary/10", "normal-case");
  });

  it("lets a caller's class win over the row layout, such as a centred grid cell", () => {
    render(<Button className="h-12 justify-center" layout="row" size="sm">Box</Button>);

    const cell = screen.getByRole("button", { name: "Box" });

    expect(cell).toHaveClass("h-12", "justify-center");
    expect(cell).not.toHaveClass("h-auto", "justify-start");
  });

  it("draws a row link the same way as a row button", () => {
    render(
      <MemoryRouter>
        <LinkButton layout="row" to="/league/MATHWORKS/cups">See all cups</LinkButton>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "See all cups" })).toHaveClass("normal-case", "w-full", "justify-start");
  });


  it("fills an inverse button lightly and edges it in strong white, so it stands out on a navy panel instead of vanishing into it", () => {
    render(<Button variant="inverse">Preview contest entry</Button>);

    const button = screen.getByRole("button", { name: "Preview contest entry" });
    expect(button).toHaveClass("bg-on-inverse-subtle", "border-inverse-border-strong", "text-on-inverse");
    expect(button).not.toHaveClass("bg-transparent");
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
