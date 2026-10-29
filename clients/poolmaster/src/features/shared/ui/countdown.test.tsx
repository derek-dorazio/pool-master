import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Countdown } from "./countdown";
import { countdownUntil } from "./countdown-parts";

const NOW = new Date("2026-05-01T12:00:00.000Z");

describe("countdownUntil", () => {
  it("splits the time remaining into whole days, hours and minutes", () => {
    // 2 days, 3 hours, 4 minutes and 59 seconds after NOW: the partial minute is dropped.
    expect(countdownUntil("2026-05-03T15:04:59.000Z", NOW)).toEqual({ days: 2, hours: 3, minutes: 4 });
  });

  it("reads zero days when less than a day remains", () => {
    expect(countdownUntil("2026-05-01T13:30:00.000Z", NOW)).toEqual({ days: 0, hours: 1, minutes: 30 });
  });

  it("never goes negative once the moment has passed", () => {
    expect(countdownUntil("2026-04-29T08:00:00.000Z", NOW)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe("Countdown", () => {
  it("shows days, hours and minutes as two-digit figures in their own boxes", () => {
    render(<Countdown label="Entries close in" now={NOW} until="2026-05-03T15:04:00.000Z" />);

    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
    expect(screen.getByText("04")).toBeInTheDocument();
    expect(screen.getByText("Days")).toBeInTheDocument();
    expect(screen.getByText("Hours")).toBeInTheDocument();
    expect(screen.getByText("Min")).toBeInTheDocument();
  });

  it("reads to a screen reader as one timer, the caller's label first", () => {
    render(<Countdown label="Entries close in" now={NOW} until="2026-05-03T15:04:00.000Z" />);

    expect(screen.getByRole("timer")).toHaveAccessibleName("Entries close in 2 days 3 hours 4 minutes");
  });

  it("reads all zeros once the moment has passed, never a negative figure", () => {
    render(<Countdown label="Picks close in" now={NOW} until="2026-04-30T12:00:00.000Z" />);

    expect(screen.getByRole("timer")).toHaveAccessibleName("Picks close in 0 days 0 hours 0 minutes");
    expect(screen.getAllByText("00")).toHaveLength(3);
  });
});
