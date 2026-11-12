import { useId } from "react";
import { Select } from "./form-field";

/** One choice a filter picker offers. */
export type FilterPickerOption = { label: string; value: string };

/** A run of choices under a name, such as a sport's leagues under the sport. */
export type FilterPickerGroup = { label: string; options: readonly FilterPickerOption[] };

/**
 * The one filter picker: a compact select with a visible label, for a filter that changes what a
 * whole page or section shows, such as a season or a sport. On a page it goes in the header's
 * `tabsEnd`; inside a section, at the end of the section's title row. Choices may come in named
 * groups. The page keeps its own value and address handling; the picker only offers the choices
 * and hands the chosen value back.
 */
export function FilterPicker({
  label,
  onChange,
  options,
  testId,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: readonly (FilterPickerOption | FilterPickerGroup)[];
  testId?: string;
  /** The value being shown; it must be among `options`. */
  value: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <label htmlFor={id}>{label}</label>
      <Select
        className="h-9 w-auto max-w-[16rem] rounded-md py-1 pl-3 pr-8"
        data-testid={testId}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => ("options" in option ? (
          <optgroup key={option.label} label={option.label}>
            {option.options.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </optgroup>
        ) : (
          <option key={option.value} value={option.value}>{option.label}</option>
        )))}
      </Select>
    </div>
  );
}
