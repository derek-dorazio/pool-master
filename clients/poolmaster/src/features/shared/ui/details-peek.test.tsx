import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailsPeek, PeekCard, PeekMessage } from "./details-peek";
import { DETAILS_PEEK_HOVER_DELAY_MS } from "./details-peek-delay";

function drawPeek(onHoverStart = vi.fn()) {
  render(
    <MemoryRouter>
      <DetailsPeek label="About Incubus 1" onHoverStart={onHoverStart} testId="peek">
        <PeekCard
          facts={[{ label: "Owners", value: "Derek Dorazio, Sam Lee" }]}
          link={{ label: "Team page", testId: "peek-link", to: "/team/1" }}
          subtitle="Team · 2 owners"
          testId="peek-card"
          title="Incubus"
        />
      </DetailsPeek>
    </MemoryRouter>,
  );
  return { button: screen.getByRole("button", { name: "About Incubus 1" }), onHoverStart };
}

describe("DetailsPeek", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits a moment after a mouse arrives before showing the card, so passing over a list does not flash it", () => {
    vi.useFakeTimers();
    const { button, onHoverStart } = drawPeek();

    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(onHoverStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("peek-card")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(DETAILS_PEEK_HOVER_DELAY_MS);
    });
    expect(screen.getByTestId("peek-card")).toBeInTheDocument();
  });

  it("never shows the card when the mouse leaves before the delay ends", () => {
    vi.useFakeTimers();
    const { button } = drawPeek();

    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(DETAILS_PEEK_HOVER_DELAY_MS);
    });

    expect(screen.queryByTestId("peek-card")).not.toBeInTheDocument();
  });

  it("stays open while the mouse moves from the icon onto the card, so its link can be reached", () => {
    vi.useFakeTimers();
    const { button } = drawPeek();

    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(DETAILS_PEEK_HOVER_DELAY_MS);
    });
    fireEvent.pointerLeave(button, { pointerType: "mouse", relatedTarget: screen.getByTestId("peek-card") });

    expect(screen.getByTestId("peek-link")).toHaveAttribute("href", "/team/1");
  });

  it("opens at once on a tap, with no mouse to wait for, and starts no hover read", () => {
    const { button, onHoverStart } = drawPeek();

    fireEvent.pointerEnter(button, { pointerType: "touch" });
    fireEvent.click(button);

    expect(screen.getByTestId("peek-card")).toBeInTheDocument();
    expect(onHoverStart).not.toHaveBeenCalled();
  });

  it("keeps a tapped-open card open when focus moves onto its link, and closes when focus leaves it", () => {
    const { button } = drawPeek();

    fireEvent.click(button);
    fireEvent.blur(button, { relatedTarget: screen.getByTestId("peek-link") });
    expect(screen.getByTestId("peek-card")).toBeInTheDocument();

    fireEvent.blur(button, { relatedTarget: document.body });
    expect(screen.queryByTestId("peek-card")).not.toBeInTheDocument();
  });
});

describe("PeekCard", () => {
  it("shows the thing's name, its subtitle, each fact by its label, and the link on", () => {
    drawPeek();
    fireEvent.click(screen.getByRole("button", { name: "About Incubus 1" }));

    const card = screen.getByTestId("peek-card");
    expect(card).toHaveTextContent("Incubus");
    expect(card).toHaveTextContent("Team · 2 owners");
    expect(screen.getByRole("term")).toHaveTextContent("Owners");
    expect(screen.getByRole("definition")).toHaveTextContent("Derek Dorazio, Sam Lee");
    expect(screen.getByTestId("peek-link")).toHaveTextContent("Team page→");
  });

  it("leaves out the subtitle and link when it has none", () => {
    render(<PeekCard facts={[{ label: "Tier", value: "1" }]} testId="card" title="Scottie Scheffler" />);

    expect(screen.getByTestId("card")).toHaveTextContent("Scottie SchefflerTier1");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("PeekMessage", () => {
  it("says the card is loading or unavailable in one italic muted line", () => {
    render(<PeekMessage testId="message">Loading…</PeekMessage>);

    expect(screen.getByTestId("message")).toHaveClass("italic", "text-muted-foreground");
  });
});
