import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DateDisplay, DateTimeField } from "./date-time";
import type { UserDto } from "@/lib/api";
import {
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

  it("rule: renders datetime-local inputs and converts ISO values", () => {
    const value = toDateTimeLocalValue("2026-04-30T12:30:00.000Z");

    render(
      <DateTimeField
        aria-label="Starts at"
        onChange={() => undefined}
        value={value}
      />,
    );

    expect(screen.getByLabelText("Starts at")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    expect(screen.getByLabelText("Starts at")).toHaveValue(value);
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
