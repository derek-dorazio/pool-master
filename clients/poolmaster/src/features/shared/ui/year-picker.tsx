import { FilterPicker } from "./filter-picker";

/**
 * The one season picker (#1554): the `FilterPicker` labelled "Season", used wherever a page reads
 * one year at a time. On a page with `PageTabs` it goes in the header's `tabsEnd`; inside a
 * section, at the end of the section's title row. The page keeps its own year source and address
 * handling; the picker only offers the years and hands the chosen one back.
 */
export function YearPicker({
  onChange,
  testId,
  value,
  years,
}: {
  onChange: (year: number) => void;
  testId?: string;
  /** The year being read; it must be among `years`. */
  value: number;
  /** The years offered, in the order shown (newest first). */
  years: number[];
}) {
  return (
    <FilterPicker
      label="Season"
      onChange={(year) => onChange(Number(year))}
      options={years.map((year) => ({ label: String(year), value: String(year) }))}
      testId={testId}
      value={String(value)}
    />
  );
}
