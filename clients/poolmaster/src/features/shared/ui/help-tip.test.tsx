import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { HelpTip } from "./help-tip";

function renderTip(learnMore?: { label: string; to: string }) {
  return render(
    <MemoryRouter>
      <HelpTip label="About the points race" learnMore={learnMore} testId="race-help">
        Each cup ranks teams by points from its contests.
      </HelpTip>
      <span>Elsewhere</span>
    </MemoryRouter>,
  );
}

const button = () => screen.getByRole("button", { name: "About the points race" });

describe("HelpTip", () => {
  it("keeps its sentences hidden until opened", () => {
    renderTip();

    expect(screen.queryByText("Each cup ranks teams by points from its contests.")).not.toBeInTheDocument();
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on mouse hover and closes when the mouse leaves", async () => {
    renderTip();

    fireEvent.pointerEnter(button(), { pointerType: "mouse" });
    expect(screen.getByTestId("race-help-callout")).toHaveTextContent("Each cup ranks teams by points from its contests.");

    fireEvent.pointerLeave(button(), { pointerType: "mouse" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(screen.queryByTestId("race-help-callout")).not.toBeInTheDocument();
  });

  it("opens on a tap and closes on a tap elsewhere", () => {
    renderTip();

    fireEvent.click(button());
    expect(screen.getByTestId("race-help-callout")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(screen.queryByTestId("race-help-callout")).not.toBeInTheDocument();
  });

  it("opens from the keyboard and closes on Escape", () => {
    renderTip();

    button().focus();
    fireEvent.click(button());
    expect(button()).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(button(), { key: "Escape" });
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });

  it("shows its one learn-more link when given", () => {
    renderTip({ label: "How to play", to: "/how-to-play" });

    fireEvent.click(button());
    expect(screen.getByRole("link", { name: "How to play →" })).toHaveAttribute("href", "/how-to-play");
  });

  it("shows no link without learnMore", () => {
    renderTip();

    fireEvent.click(button());
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
