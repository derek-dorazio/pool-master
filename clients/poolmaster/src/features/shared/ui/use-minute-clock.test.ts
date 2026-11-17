import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMinuteClock } from "./use-minute-clock";

describe("useMinuteClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at the current time and moves on a minute at a time, so a countdown keeps moving", () => {
    vi.useFakeTimers({ now: new Date("2026-04-01T12:00:00.000Z") });
    const { result } = renderHook(() => useMinuteClock());
    expect(result.current.toISOString()).toBe("2026-04-01T12:00:00.000Z");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.toISOString()).toBe("2026-04-01T12:01:00.000Z");
  });
});
