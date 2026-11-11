import { useId } from "react";
import { Select } from "./form-field";

/**
 * The one season picker (#1554): a compact select with a visible "Season" label, used wherever
 * a page reads one year at a time. On a page with `PageTabs` it goes in the header's `tabsEnd`;
 * inside a section, at the end of the section's title row. The page keeps its own year source
 * and address handling; the picker only offers the years and hands the chosen one back.
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
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <label htmlFor={id}>Season</label>
      <Select
        className="h-9 w-auto rounded-md py-1 pl-3 pr-8"
        data-testid={testId}
        id={id}
        onChange={(event) => onChange(Number(event.target.value))}
        value={value}
      >
        {years.map((year) => <option key={year} value={year}>{year}</option>)}
      </Select>
    </div>
  );
}
