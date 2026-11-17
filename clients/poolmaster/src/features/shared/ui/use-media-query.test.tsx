import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { deviceListenerCount, resetDeviceColorScheme, setDeviceWidth } from "@/test/device-color-scheme";
import { WIDE_SCREEN_QUERY, useMediaQuery } from "./use-media-query";

function Probe() {
  return <span data-testid="probe">{useMediaQuery(WIDE_SCREEN_QUERY) ? "wide" : "narrow"}</span>;
}

describe("useMediaQuery", () => {
  afterEach(() => resetDeviceColorScheme());

  it("answers narrow on a phone's width and wide on a desktop's", () => {
    setDeviceWidth(390);
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("narrow");
    unmount();

    setDeviceWidth(1280);
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("wide");
  });

  it("follows the window as it widens and narrows, and stops listening once unmounted", () => {
    setDeviceWidth(390);
    const listenersBefore = deviceListenerCount();
    const { unmount } = render(<Probe />);

    act(() => setDeviceWidth(1280));
    expect(screen.getByTestId("probe")).toHaveTextContent("wide");
    act(() => setDeviceWidth(800));
    expect(screen.getByTestId("probe")).toHaveTextContent("narrow");

    unmount();
    expect(deviceListenerCount()).toBe(listenersBefore);
  });
});
