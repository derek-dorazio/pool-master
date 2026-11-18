import { describe, expect, it } from "vitest";
import { formatGridDate, type DisplayPreferences } from "./date-time-format";

const US: DisplayPreferences = { timeZone: "America/New_York", locale: "en-US", hour12: true };
const UK: DisplayPreferences = { timeZone: "Europe/London", locale: "en-GB", hour12: false };
const WORDS = { format: "words", withTime: false } as const;
const NUMERIC = { format: "numeric", withTime: false } as const;

describe("formatGridDate", () => {
  it("writes the month as a word or a number in the member's locale order, the day always two digits", () => {
    expect(formatGridDate("2027-03-05", WORDS, US)).toBe("Mar 05, 2027");
    expect(formatGridDate("2027-03-05", NUMERIC, US)).toBe("03/05/2027");
    expect(formatGridDate("2027-03-05", WORDS, UK)).toBe("05 Mar 2027");
    expect(formatGridDate("2027-03-05", NUMERIC, UK)).toBe("05/03/2027");
  });

  it("writes a time on the member's clock, hour and minute two digits", () => {
    const instant = "2027-03-05T14:04:00.000Z";
    expect(formatGridDate(instant, { format: "words", withTime: true }, US)).toBe("Mar 05, 2027, 09:04 AM");
    expect(formatGridDate(instant, { format: "numeric", withTime: true }, UK)).toBe("05/03/2027, 14:04");
  });

  it("shows an instant on the day it falls in the member's zone, and a calendar date on its own day anywhere", () => {
    expect(formatGridDate("2027-03-05T03:00:00.000Z", WORDS, US)).toBe("Mar 04, 2027");
    expect(formatGridDate("2027-03-05", WORDS, { ...US, timeZone: "Pacific/Honolulu" })).toBe("Mar 05, 2027");
  });

  it("writes nothing for no date or one that cannot be read", () => {
    expect(formatGridDate(null, WORDS, US)).toBe("");
    expect(formatGridDate("not a date", WORDS, US)).toBe("");
  });
});
