import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DateDisplay, DateTimeField } from "./date-time";
import type { UserDto } from "@/lib/api";
import {
  dateTimeLocalValueToIso,
  DEFAULT_DISPLAY_PREFERENCES,
  displayPreferencesOf,
  formatDateDisplay,
  formatDateTimeDisplay,
  toDateTimeLocalValue,
} from "./date-time-format";
import { DisplayPreferencesContext } from "./display-preferences";

const user: UserDto = {
  id: "user-1",
  email: "member@example.com",
  username: "member",
  firstName: "Morgan",
  lastName: "Member",
  isActive: true,
  isRootAdmin: false,
};

describe("pool-master-3lo.18: shared DateTimeField and DateDisplay primitives", () => {
  it("rule: formats valid dates and uses a fallback for missing dates", () => {
    render(
      <>
        <DateDisplay value="2026-04-30T12:30:00.000Z" />
        <DateDisplay value={null} />
      </>,
    );

    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("fills an entry box with the wall clock in the member's zone and names the zone beside it", () => {
    const pacific = displayPreferencesOf({ ...user, timezone: "America/Los_Angeles" });
    const value = toDateTimeLocalValue("2026-04-30T12:30:00.000Z", pacific.timeZone);

    render(
      <DisplayPreferencesContext.Provider value={pacific}>
        <DateTimeField aria-label="Starts at" onChange={() => undefined} value={value} />
      </DisplayPreferencesContext.Provider>,
    );

    expect(screen.getByLabelText("Starts at")).toHaveAttribute("type", "datetime-local");
    expect(screen.getByLabelText("Starts at")).toHaveValue("2026-04-30T05:30");
    expect(screen.getByText("PT")).toBeInTheDocument();
  });

  it("reads an entry box as the wall clock in the member's zone, whatever the computer's zone, on each side of a daylight saving change and in the hours it repeats or skips", () => {
    expect(dateTimeLocalValueToIso("2026-04-30T20:00", "America/New_York")).toBe("2026-05-01T00:00:00.000Z");
    expect(dateTimeLocalValueToIso("2026-01-15T20:00", "America/New_York")).toBe("2026-01-16T01:00:00.000Z");
    expect(dateTimeLocalValueToIso("2026-04-30T20:00", "Asia/Tokyo")).toBe("2026-04-30T11:00:00.000Z");
    expect(toDateTimeLocalValue("2026-05-01T00:00:00.000Z", "America/New_York")).toBe("2026-04-30T20:00");
    expect(toDateTimeLocalValue(null, "America/New_York")).toBe("");
    // An hour the clocks repeat is its first occurrence; one they skip moves forward by the gap.
    expect(dateTimeLocalValueToIso("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
    expect(dateTimeLocalValueToIso("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    expect(dateTimeLocalValueToIso("2026-03-29T01:30", "Europe/London")).toBe("2026-03-29T01:30:00.000Z");
    expect(dateTimeLocalValueToIso("2026-10-04T02:30", "Australia/Sydney")).toBe("2026-10-03T16:30:00.000Z");
    expect(dateTimeLocalValueToIso("2026-07-01T09:15", "Asia/Kathmandu")).toBe("2026-07-01T03:30:00.000Z");
    expect(dateTimeLocalValueToIso("", "America/New_York")).toBeUndefined();
    expect(dateTimeLocalValueToIso("not-a-date", "America/New_York")).toBeUndefined();
  });

  it("shows a date and time in the member's zone with the zone named, and US Eastern for someone with none", () => {
    // 11:30 PM on Thursday in US Eastern, already Friday in UTC and Tokyo.
    const isoValue = "2026-04-24T03:30:00.000Z";
    const tokyo = displayPreferencesOf({ ...user, timezone: "Asia/Tokyo", timeFormat: "24H" });

    expect(formatDateDisplay(isoValue, DEFAULT_DISPLAY_PREFERENCES)).toBe("4/23/2026");
    expect(formatDateTimeDisplay(isoValue, DEFAULT_DISPLAY_PREFERENCES)).toBe("4/23/2026, 11:30 PM EDT");
    expect(formatDateDisplay(isoValue, tokyo)).toBe("4/24/2026");
    expect(formatDateTimeDisplay(isoValue, tokyo)).toBe("4/24/2026, 12:30 GMT+9");
    expect(formatDateDisplay(null, DEFAULT_DISPLAY_PREFERENCES, "Unknown")).toBe("Unknown");
    expect(formatDateTimeDisplay("not-a-date", DEFAULT_DISPLAY_PREFERENCES, "Unknown")).toBe("Unknown");
  });

  it("formats in the member's locale and clock", () => {
    const london = displayPreferencesOf({ ...user, timezone: "Europe/London", locale: "en-GB", timeFormat: "24H" });

    expect(formatDateTimeDisplay("2026-07-01T18:05:00.000Z", london)).toBe("01/07/2026, 19:05 BST");
  });

  it("writes a German member's dates in English words with their region's day order and clock", () => {
    const berlin = displayPreferencesOf({ ...user, timezone: "Europe/Berlin", locale: "de-DE" });

    render(
      <DisplayPreferencesContext.Provider value={berlin}>
        <DateDisplay value="2026-04-09T11:40:00.000Z" />
      </DisplayPreferencesContext.Provider>,
    );

    expect(screen.getByText("9 Apr 2026, 13:40 CEST")).toBeInTheDocument();
  });

  it("shows DateDisplay in the signed-in member's zone, named", () => {
    render(
      <DisplayPreferencesContext.Provider value={displayPreferencesOf({ ...user, timezone: "America/Los_Angeles" })}>
        <DateDisplay value="2026-04-24T03:30:00.000Z" />
        <DateDisplay timeStyle={null} value="2026-04-24T03:30:00.000Z" />
      </DisplayPreferencesContext.Provider>,
    );

    expect(screen.getByText("Apr 23, 2026, 8:30 PM PDT")).toBeInTheDocument();
    expect(screen.getByText("Apr 23, 2026")).toBeInTheDocument();
  });
});
