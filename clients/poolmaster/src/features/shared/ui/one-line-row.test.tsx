import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OneLineRow } from "./one-line-row";

const items = (count: number) => Array.from({ length: count }, (_, index) => ({ key: String(index), node: <i data-testid={`item-${index}`} /> }));

let restoreWidth: () => void = () => undefined;
afterEach(() => restoreWidth());

/** Every element reads `width` px wide, until put back. */
function setWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
  restoreWidth = () => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  };
}

describe("OneLineRow", () => {
  it("shows as many items as fit on one line after the room for \"+N\", and counts the rest, named by its whole list", () => {
    setWidth(100);
    render(<OneLineRow itemPx={24} items={items(6)} label="On six sports" testId="row" />);

    // (100 - 28) / 24 = 3 fit.
    expect(screen.getAllByTestId(/^item-/)).toHaveLength(3);
    expect(screen.getByTestId("row-more")).toHaveTextContent("+3");
    expect(screen.getByRole("img", { name: "On six sports" })).toBe(screen.getByTestId("row"));
  });

  it("shows every item with no \"+N\" when they all fit", () => {
    setWidth(200);
    render(<OneLineRow itemPx={24} items={items(6)} label="On six sports" testId="row" />);

    expect(screen.getAllByTestId(/^item-/)).toHaveLength(6);
    expect(screen.queryByTestId("row-more")).not.toBeInTheDocument();
  });

  it("shows every item until the row has been measured", () => {
    render(<OneLineRow itemPx={24} items={items(20)} label="On twenty sports" />);

    expect(screen.getAllByTestId(/^item-/)).toHaveLength(20);
  });

  it("measures again when the row is resized", () => {
    const observers: ResizeObserverCallback[] = [];
    const Original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { observers.push(callback); }
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    setWidth(200);
    render(<OneLineRow itemPx={24} items={items(6)} label="On six sports" testId="row" />);
    expect(screen.queryByTestId("row-more")).not.toBeInTheDocument();

    setWidth(76);
    act(() => observers.forEach((callback) => callback([], {} as ResizeObserver)));
    expect(screen.getByTestId("row-more")).toHaveTextContent("+4");
    globalThis.ResizeObserver = Original;
  });
});
