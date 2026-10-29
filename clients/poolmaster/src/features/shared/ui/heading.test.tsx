import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Heading } from "./heading";

describe("Heading", () => {
  it("renders the tag its level names, whatever the look, so a page keeps one h1 and a correct outline", () => {
    render(
      <>
        <Heading level={1} variant="card">League home</Heading>
        <Heading level={3} variant="hero">The biggest stars</Heading>
      </>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "League home" })).toHaveClass("title-card");
    expect(screen.getByRole("heading", { level: 3, name: "The biggest stars" })).toHaveClass("font-black");
  });

  it("draws the hero as the large black italic display line, growing on wider screens", () => {
    render(<Heading level={1} variant="hero">Championship Weekend</Heading>);

    expect(screen.getByRole("heading")).toHaveClass("font-display", "font-black", "italic", "text-3xl", "sm:text-4xl", "lg:text-5xl");
  });

  it("draws a display section title in the display face without the card's uppercase", () => {
    render(<Heading level={2} variant="display">How it works</Heading>);

    const heading = screen.getByRole("heading");
    expect(heading).toHaveClass("font-display", "text-3xl", "font-bold");
    expect(heading).not.toHaveClass("title-card");
  });

  it("keeps page and section titles in normal case, outside the display face", () => {
    render(
      <>
        <Heading level={1} variant="page">Profile</Heading>
        <Heading level={2} variant="section">Remove owner</Heading>
      </>,
    );

    expect(screen.getByRole("heading", { name: "Profile" })).toHaveClass("text-3xl", "font-semibold");
    expect(screen.getByRole("heading", { name: "Remove owner" })).toHaveClass("text-xl", "sm:text-2xl");
    for (const heading of screen.getAllByRole("heading")) {
      expect(heading).not.toHaveClass("font-display", "title-card", "uppercase");
    }
  });

  it("draws a card title in the house uppercase italic at the size its card asks for", () => {
    render(<Heading level={3} size="lg" variant="card">Your squads</Heading>);

    expect(screen.getByRole("heading")).toHaveClass("title-card", "text-lg");
  });

  it("colours a title with the foreground by default, and leaves it to its panel when told to inherit", () => {
    render(
      <>
        <Heading level={2} variant="card">On the page</Heading>
        <Heading level={2} tone="inherit" variant="card">On a navy panel</Heading>
        <Heading level={2} tone="primary" variant="card">Highlighted</Heading>
      </>,
    );

    expect(screen.getByRole("heading", { name: "On the page" })).toHaveClass("text-foreground");
    expect(screen.getByRole("heading", { name: "On a navy panel" })).not.toHaveClass("text-foreground");
    expect(screen.getByRole("heading", { name: "Highlighted" })).toHaveClass("text-primary");
  });

  it("passes ids and test ids through, so a dialog can point its label at the title", () => {
    render(<Heading data-testid="contest-title" id="dialog-title" level={2} variant="page">Masters picks</Heading>);

    expect(screen.getByTestId("contest-title")).toHaveAttribute("id", "dialog-title");
  });
});
