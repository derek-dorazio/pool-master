import { describe, expect, it } from "vitest";
import {
  calendarPeriods,
  describeSpan,
  firstDayOfWeek,
  parseSpanText,
  quickEntries,
  resolveSpan,
  type DateSpan,
} from "./data-grid-date-spans";
import type { DisplayPreferences } from "./date-time-format";

const US: DisplayPreferences = { timeZone: "America/New_York", locale: "en-US", hour12: true };
const UK: DisplayPreferences = { timeZone: "Europe/London", locale: "en-GB", hour12: false };
// Wednesday 18 November 2026, 10:30 AM in New York.
const NOW = Date.parse("2026-11-18T15:30:00Z");
const HOUR = 3_600_000;

const iso = (instant: number | null) => (instant === null ? null : new Date(instant).toISOString());
const resolved = (span: DateSpan, preferences = US) => {
  const { from, to } = resolveSpan(span, NOW, preferences);
  return { from: iso(from), to: iso(to) };
};

describe("typed spans", () => {
  it.each([
    ["2h", { toward: "past", amount: 2, unit: "h" }],
    ["3d", { toward: "past", amount: 3, unit: "d" }],
    ["1w", { toward: "past", amount: 1, unit: "w" }],
    ["30m", { toward: "past", amount: 30, unit: "m" }],
    ["45 minutes", { toward: "past", amount: 45, unit: "m" }],
    ["last 2 days", { toward: "past", amount: 2, unit: "d" }],
  ])("reads %s on a past column as a Past span", (text, expected) => {
    expect(parseSpanText(text, "past", US, NOW)).toEqual({ kind: "relative", ...expected });
  });

  it("reads a bare span as Next on a future column, and next or + as Next on a column lying both ways", () => {
    expect(parseSpanText("2h", "future", US, NOW)).toEqual({ kind: "relative", toward: "next", amount: 2, unit: "h" });
    expect(parseSpanText("2h", "both", US, NOW)).toEqual({ kind: "relative", toward: "past", amount: 2, unit: "h" });
    expect(parseSpanText("next 2h", "both", US, NOW)).toEqual({ kind: "relative", toward: "next", amount: 2, unit: "h" });
    expect(parseSpanText("+3d", "both", US, NOW)).toEqual({ kind: "relative", toward: "next", amount: 3, unit: "d" });
  });

  it.each(["", "abc", "0h", "2y", "next 2h"])("reads %j on a past column as nothing", (text) => {
    expect(parseSpanText(text, "past", US, NOW)).toBeNull();
  });

  it("refuses Past on a future column", () => {
    expect(parseSpanText("past 2h", "future", US, NOW)).toBeNull();
  });

  it("resolves a relative span back or forward from now", () => {
    expect(resolved({ kind: "relative", toward: "past", amount: 2, unit: "h" })).toEqual({
      from: iso(NOW - 2 * HOUR),
      to: iso(NOW),
    });
    expect(resolved({ kind: "relative", toward: "next", amount: 1, unit: "w" })).toEqual({
      from: iso(NOW),
      to: iso(NOW + 7 * 24 * HOUR),
    });
  });
});

describe("typed dates and ranges", () => {
  it("reads a date as its whole day in the member's zone, the year defaulting to this one", () => {
    expect(parseSpanText("Nov 17", "both", US, NOW)).toEqual({
      kind: "between",
      from: "2026-11-17T05:00:00.000Z",
      to: "2026-11-18T04:59:59.999Z",
    });
    expect(parseSpanText("17 Nov 2025", "both", US, NOW)).toEqual({
      kind: "between",
      from: "2025-11-17T05:00:00.000Z",
      to: "2025-11-18T04:59:59.999Z",
    });
  });

  it("reads a date with a time as that minute", () => {
    expect(parseSpanText("Nov 17, 2026 10:00 AM", "both", US, NOW)).toEqual({
      kind: "between",
      from: "2026-11-17T15:00:00.000Z",
      to: "2026-11-17T15:00:59.999Z",
    });
    expect(parseSpanText("2026-11-17 22:30", "both", UK, NOW)).toEqual({
      kind: "between",
      from: "2026-11-17T22:30:00.000Z",
      to: "2026-11-17T22:30:59.999Z",
    });
  });

  it("reads a numeric date month first in en-US and day first elsewhere", () => {
    expect(parseSpanText("3/5/2027", "both", US, NOW)).toMatchObject({ from: "2027-03-05T05:00:00.000Z" });
    expect(parseSpanText("3/5/2027", "both", UK, NOW)).toMatchObject({ from: "2027-05-02T23:00:00.000Z" });
  });

  it("reads > and < as one open end, after or before the day, and >= and <= as including it", () => {
    expect(parseSpanText("> Nov 17", "both", US, NOW)).toEqual({ kind: "between", from: "2026-11-18T05:00:00.000Z", to: null });
    expect(parseSpanText(">= Nov 17", "both", US, NOW)).toEqual({ kind: "between", from: "2026-11-17T05:00:00.000Z", to: null });
    expect(parseSpanText("< Dec 1", "both", US, NOW)).toEqual({ kind: "between", from: null, to: "2026-12-01T04:59:59.999Z" });
    expect(parseSpanText("<= Dec 1", "both", US, NOW)).toEqual({ kind: "between", from: null, to: "2026-12-02T04:59:59.999Z" });
    expect(parseSpanText("> Nov 17 10:00 AM", "both", US, NOW)).toEqual({
      kind: "between",
      from: "2026-11-17T15:01:00.000Z",
      to: null,
    });
  });

  it("reads a range with a dash or 'to', both days whole, and refuses one running backwards", () => {
    const november = { kind: "between", from: "2026-11-01T04:00:00.000Z", to: "2026-12-01T04:59:59.999Z" };
    expect(parseSpanText("Nov 1 – Nov 30", "both", US, NOW)).toEqual(november);
    expect(parseSpanText("Nov 1 - Nov 30", "both", US, NOW)).toEqual(november);
    expect(parseSpanText("Nov 1 to Nov 30", "both", US, NOW)).toEqual(november);
    expect(parseSpanText("Nov 30 – Nov 1", "both", US, NOW)).toBeNull();
  });

  it.each(["Feb 30", "13/40/2026", "Nov 17 25:00", "Nov 17 13 PM"])("reads %j as nothing", (text) => {
    expect(parseSpanText(text, "both", US, NOW)).toBeNull();
  });
});

describe("calendar periods", () => {
  it("covers today, yesterday and tomorrow as whole days in the member's zone", () => {
    expect(resolved({ kind: "calendar", period: "today" })).toEqual({
      from: "2026-11-18T05:00:00.000Z",
      to: "2026-11-19T04:59:59.999Z",
    });
    expect(resolved({ kind: "calendar", period: "yesterday" })).toMatchObject({ from: "2026-11-17T05:00:00.000Z" });
    expect(resolved({ kind: "calendar", period: "tomorrow" })).toMatchObject({ from: "2026-11-19T05:00:00.000Z" });
  });

  it("starts the week on Sunday in en-US and Monday in en-GB", () => {
    expect(firstDayOfWeek("en-US")).toBe(7);
    expect(firstDayOfWeek("en-GB")).toBe(1);
    expect(resolved({ kind: "calendar", period: "weekToDate" })).toEqual({ from: "2026-11-15T05:00:00.000Z", to: iso(NOW) });
    expect(resolved({ kind: "calendar", period: "previousWeek" })).toEqual({
      from: "2026-11-08T05:00:00.000Z",
      to: "2026-11-15T04:59:59.999Z",
    });
    expect(resolved({ kind: "calendar", period: "thisWeek" }, UK)).toEqual({
      from: "2026-11-16T00:00:00.000Z",
      to: "2026-11-22T23:59:59.999Z",
    });
    expect(resolved({ kind: "calendar", period: "nextWeek" }, UK)).toMatchObject({ from: "2026-11-23T00:00:00.000Z" });
  });

  it("covers months across a daylight saving change and years whole", () => {
    expect(resolved({ kind: "calendar", period: "previousMonth" })).toEqual({
      from: "2026-10-01T04:00:00.000Z",
      // Clocks go back at 2 AM on Nov 1, so its midnight is still daylight time.
      to: "2026-11-01T03:59:59.999Z",
    });
    expect(resolved({ kind: "calendar", period: "monthToDate" })).toEqual({ from: "2026-11-01T04:00:00.000Z", to: iso(NOW) });
    expect(resolved({ kind: "calendar", period: "thisMonth" })).toMatchObject({ to: "2026-12-01T04:59:59.999Z" });
    expect(resolved({ kind: "calendar", period: "nextMonth" })).toEqual({
      from: "2026-12-01T05:00:00.000Z",
      to: "2027-01-01T04:59:59.999Z",
    });
    expect(resolved({ kind: "calendar", period: "yearToDate" })).toEqual({ from: "2026-01-01T05:00:00.000Z", to: iso(NOW) });
    expect(resolved({ kind: "calendar", period: "previousYear" })).toEqual({
      from: "2025-01-01T05:00:00.000Z",
      to: "2026-01-01T04:59:59.999Z",
    });
  });
});

describe("the lists a direction offers", () => {
  it("offers Past entries for a past column, Next ones (no minutes) for a future one, and Past then Next for both", () => {
    expect(quickEntries("past").every((entry) => entry.toward === "past")).toBe(true);
    expect(quickEntries("future").map((entry) => `${entry.unit}${entry.amount ?? "N"}`)).toEqual([
      "h1", "hN", "d1", "dN", "w1", "wN",
    ]);
    expect(quickEntries("both").map((entry) => entry.toward)).toEqual([...Array<string>(7).fill("past"), ...Array<string>(6).fill("next")]);
  });

  it("offers past periods, future ones, or both with Today once", () => {
    expect(calendarPeriods("past")).toEqual([
      "today", "yesterday", "weekToDate", "previousWeek", "monthToDate", "previousMonth", "yearToDate", "previousYear",
    ]);
    expect(calendarPeriods("future")).toEqual(["today", "tomorrow", "thisWeek", "nextWeek", "thisMonth", "nextMonth"]);
    expect(calendarPeriods("both").filter((period) => period === "today")).toHaveLength(1);
    expect(calendarPeriods("both")).toHaveLength(13);
  });
});

describe("span names", () => {
  it("names a span as the chip and the Filtered line show it", () => {
    expect(describeSpan({ kind: "relative", toward: "past", amount: 1, unit: "h" }, US, true)).toBe("Past 1 hour");
    expect(describeSpan({ kind: "relative", toward: "next", amount: 3, unit: "d" }, US, true)).toBe("Next 3 days");
    expect(describeSpan({ kind: "calendar", period: "previousMonth" }, US, true)).toBe("Previous month");
    expect(describeSpan({ kind: "between", from: "2026-11-01T04:00:00.000Z", to: "2026-12-01T04:59:59.999Z" }, US, false)).toBe(
      "Nov 01, 2026 – Nov 30, 2026",
    );
    expect(describeSpan({ kind: "between", from: "2026-11-18T05:00:00.000Z", to: null }, US, false)).toBe("From Nov 18, 2026");
    expect(describeSpan({ kind: "between", from: null, to: "2026-12-01T04:59:59.999Z" }, US, false)).toBe("Through Nov 30, 2026");
    expect(describeSpan({ kind: "between", from: null, to: null }, US, false)).toBe("Any time");
  });
});
