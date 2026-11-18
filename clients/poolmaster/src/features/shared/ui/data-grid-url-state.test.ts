import { describe, expect, it } from "vitest";
import { resolveSpan } from "./data-grid-date-spans";
import { decodeGridState, encodeGridState, type GridUrlColumn, type GridUrlState } from "./data-grid-url-state";
import type { DisplayPreferences } from "./date-time-format";

const US: DisplayPreferences = { timeZone: "America/New_York", locale: "en-US", hour12: true };
const NOW = Date.parse("2026-11-18T15:30:00Z");

const COLUMNS: GridUrlColumn[] = [
  { id: "name", type: { kind: "text" }, canSort: true, canFilter: true },
  { id: "status", type: { kind: "enum" }, canSort: true, canFilter: true },
  { id: "active", type: { kind: "boolean", nullable: true }, canSort: true, canFilter: true },
  { id: "members", type: { kind: "number" }, canSort: true, canFilter: true },
  { id: "starts", type: { kind: "datetime", direction: "both" }, canSort: true, canFilter: true },
  { id: "season", type: { kind: "dateRange", direction: "both" }, canSort: true, canFilter: true },
  { id: "actions", type: undefined, canSort: false, canFilter: false },
];

const roundTrip = (state: GridUrlState) => decodeGridState(encodeGridState(state), COLUMNS, US, NOW);

describe("a grid's filters and sort in the page link", () => {
  it("keeps nothing for a grid with no sort and no filters", () => {
    expect(encodeGridState({ sorting: [], filters: [] })).toBeNull();
    expect(decodeGridState(null, COLUMNS, US, NOW)).toBeNull();
  });

  it("round-trips the sort, ascending or descending", () => {
    expect(roundTrip({ sorting: [{ id: "members", desc: true }], filters: [] })).toEqual({
      sorting: [{ id: "members", desc: true }],
      filters: [],
    });
    expect(encodeGridState({ sorting: [{ id: "name", desc: false }], filters: [] })).toBe('{"s":"name"}');
  });

  it("round-trips each filter type: text, enum, yes/no and number", () => {
    const filters = [
      { id: "name", value: { kind: "text", term: "Alpha", match: "startsWith" } },
      { id: "status", value: { kind: "enum", values: ["OPEN", "LIVE"], match: "any" } },
      { id: "active", value: { kind: "enum", values: ["true", "__none__"], match: "any" } },
      { id: "members", value: { kind: "number", match: "between", from: 10, to: null } },
    ];

    expect(roundTrip({ sorting: [], filters })).toEqual({ sorting: [], filters });
  });

  it("keeps a date filter's span, not its instants, and resolves it again when the link opens", () => {
    const span = { kind: "relative", toward: "past", amount: 2, unit: "h" } as const;
    const applied = { kind: "date", span, from: 1, to: 2, timeZone: "Europe/London", match: "overlaps" };
    const link = encodeGridState({ sorting: [], filters: [{ id: "starts", value: applied }] });

    expect(link).toBe('{"f":{"starts":{"kind":"date","span":{"kind":"relative","toward":"past","amount":2,"unit":"h"},"match":"overlaps"}}}');
    expect(decodeGridState(link, COLUMNS, US, NOW)?.filters).toEqual([
      { id: "starts", value: { kind: "date", span, ...resolveSpan(span, NOW, US), timeZone: US.timeZone, match: "overlaps" } },
    ]);
  });

  it("round-trips a calendar period and a typed range on a date range column with its match", () => {
    const period = { kind: "calendar", period: "previousMonth" } as const;
    const between = { kind: "between", from: "2026-11-01T04:00:00.000Z", to: null } as const;
    const decoded = roundTrip({
      sorting: [],
      filters: [
        { id: "starts", value: { kind: "date", span: period, from: 0, to: 0, timeZone: "x", match: "overlaps" } },
        { id: "season", value: { kind: "date", span: between, from: 0, to: null, timeZone: "x", match: "startsWithin" } },
      ],
    });

    expect(decoded?.filters.map(({ id, value }) => [id, value])).toEqual([
      ["starts", expect.objectContaining({ span: period, ...resolveSpan(period, NOW, US) })],
      ["season", expect.objectContaining({ span: between, match: "startsWithin" })],
    ]);
  });

  it.each([
    ["text that isn't JSON", "not json"],
    ["a list instead of an object", "[1,2]"],
  ])("reads %s as nothing kept", (_, raw) => {
    expect(decodeGridState(raw, COLUMNS, US, NOW)).toBeNull();
  });

  it("drops what the grid can't use and keeps the rest", () => {
    const raw = JSON.stringify({
      s: "-actions",
      f: {
        gone: { kind: "text", term: "x", match: "contains" },
        actions: { kind: "text", term: "x", match: "contains" },
        name: { kind: "text", term: "", match: "contains" },
        status: { kind: "enum", values: [], match: "any" },
        active: { kind: "enum", values: ["true"], match: "some" },
        members: { kind: "number", match: "between", from: "10", to: null },
        starts: { kind: "date", span: { kind: "relative", toward: "past", amount: 0, unit: "h" }, match: "overlaps" },
        season: { kind: "date", span: { kind: "between", from: "2026-12-01", to: "2026-11-01" }, match: "overlaps" },
      },
    });

    expect(decodeGridState(raw, COLUMNS, US, NOW)).toEqual({ sorting: [], filters: [] });
  });

  it("drops a filter written for another type of column, such as a number filter on a text column", () => {
    const raw = JSON.stringify({ s: "name", f: { name: { kind: "number", match: "equals", from: 3, to: null } } });

    expect(decodeGridState(raw, COLUMNS, US, NOW)).toEqual({ sorting: [{ id: "name", desc: false }], filters: [] });
  });
});
