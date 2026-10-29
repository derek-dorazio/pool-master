import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InfoPopover } from "./info-popover";

function drawPopover() {
  render(
    <InfoPopover icon={<span>i</span>} label="Entry status: Submitted" testId="status">
      <p>Entries close when the event starts</p>
    </InfoPopover>,
  );
  return screen.getByTestId("status");
}

describe("InfoPopover", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shifts the callout left so it ends inside the screen when its icon sits near the right edge", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: window.innerWidth - 100 } as DOMRect);
    const button = drawPopover();

    fireEvent.click(button);

    // 288 wide from 100 short of the edge, inside a 16 gutter: 204 to the left.
    expect(screen.getByTestId("status-callout")).toHaveStyle({ left: "-204px" });
  });

  it("leaves the callout under its icon when there is room", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 16 } as DOMRect);
    fireEvent.click(drawPopover());

    expect(screen.getByTestId("status-callout")).toHaveStyle({ left: "0px" });
  });

  it("names the button for what the callout is about and keeps the callout closed until asked", () => {
    const button = drawPopover();

    expect(button).toHaveAccessibleName("Entry status: Submitted");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("status-callout")).not.toBeInTheDocument();
  });

  it("opens the callout while a mouse hovers the icon and closes it when the mouse leaves", () => {
    const button = drawPopover();

    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    expect(screen.getByTestId("status-callout")).toHaveTextContent("Entries close when the event starts");

    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    expect(screen.queryByTestId("status-callout")).not.toBeInTheDocument();
  });

  it("opens on a tap and closes on a second tap, since a phone's tap must not open and close it at once", () => {
    const button = drawPopover();

    fireEvent.pointerEnter(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("status-callout")).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.queryByTestId("status-callout")).not.toBeInTheDocument();
  });

  it("closes a tapped-open callout on a tap anywhere else on the page", () => {
    const button = drawPopover();

    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByTestId("status-callout"));
    expect(screen.getByTestId("status-callout")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("status-callout")).not.toBeInTheDocument();
  });

  it("closes on Escape and when focus moves elsewhere", () => {
    const button = drawPopover();

    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByTestId("status-callout")).not.toBeInTheDocument();

    fireEvent.click(button);
    fireEvent.blur(button);
    expect(screen.queryByTestId("status-callout")).not.toBeInTheDocument();
  });
});
