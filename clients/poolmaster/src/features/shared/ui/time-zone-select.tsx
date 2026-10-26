import { forwardRef, useMemo } from "react";
import { Select, type SelectProps } from "./form-field";
import { timeZoneOptions } from "./time-zone-options";

type TimeZoneSelectProps = Omit<SelectProps, "children"> & {
  /** The zone currently chosen, so a saved zone outside the lists still shows. */
  value?: string;
};

/** A time zone drop-down: US zones first, then every other zone (#1041). */
export const TimeZoneSelect = forwardRef<HTMLSelectElement, TimeZoneSelectProps>(
  function TimeZoneSelect({ value, ...props }, ref) {
    const options = useMemo(() => timeZoneOptions(value), [value]);
    return (
      <Select ref={ref} value={value} {...props}>
        <optgroup label="United States">
          {options.us.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Other time zones">
          {options.other.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      </Select>
    );
  },
);
