import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip, StatusBadge } from "./status-badge";

describe("pool-master-3lo.5: shared StatusBadge and Chip primitives", () => {
  it("rule: renders lifecycle statuses through semantic tones", () => {
    render(<StatusBadge tone="active">Active</StatusBadge>);

    expect(screen.getByText("Active")).toHaveClass(
      "[color:var(--status-active-text)]",
    );
  });

  it("rule: renders compact chips without uppercase transformation", () => {
    render(<Chip tone="warning">Needs review</Chip>);

    expect(screen.getByText("Needs review")).toHaveClass("normal-case");
  });

  it("draws the brand pill filled gold with its dark text", () => {
    render(<Chip tone="brand">New</Chip>);

    expect(screen.getByText("New")).toHaveClass("bg-primary", "text-primary-foreground", "normal-case");
  });

  it("outlines the brand pill in the colour of its text, so it reads on navy and on white alike", () => {
    render(<StatusBadge className="text-primary" tone="brandOutline">The ultimate pool</StatusBadge>);

    const pill = screen.getByText("The ultimate pool");
    expect(pill).toHaveClass("border-current", "bg-transparent", "font-display", "uppercase", "text-primary");
  });

  it("draws an open round as a gold-tinted pill and a round still to come as a dashed one", () => {
    render(
      <>
        <Chip tone="brandTint">NBA</Chip>
        <Chip tone="placeholder">WNBA</Chip>
      </>,
    );

    expect(screen.getByText("NBA")).toHaveClass("border-primary", "bg-primary/10");
    expect(screen.getByText("WNBA")).toHaveClass("border-dashed", "text-muted-foreground");
  });

  it("draws the pill on its child when asked, so a pill that goes somewhere stays one link", () => {
    render(
      <Chip asChild tone="brandTint">
        <a href="/play/nba">NBA</a>
      </Chip>,
    );

    const link = screen.getByRole("link", { name: "NBA" });
    expect(link).toHaveClass("rounded-full", "bg-primary/10");
    expect(link).toHaveAttribute("href", "/play/nba");
  });
});
