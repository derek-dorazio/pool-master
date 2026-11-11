import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { YearPicker } from "./year-picker";

describe("YearPicker", () => {
  it("shows a visible Season label naming the select, with the years offered in the order given and the current one chosen", () => {
    render(<YearPicker onChange={() => undefined} testId="picker" value={2025} years={[2026, 2025, 2024]} />);

    const picker = screen.getByRole("combobox", { name: "Season" });
    expect(screen.getByText("Season")).toBeVisible();
    expect(picker).toBe(screen.getByTestId("picker"));
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["2026", "2025", "2024"]);
    expect(picker).toHaveValue("2025");
  });

  it("hands the chosen year back as a number", () => {
    const onChange = vi.fn();
    render(<YearPicker onChange={onChange} value={2026} years={[2026, 2025]} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Season" }), { target: { value: "2025" } });

    expect(onChange).toHaveBeenCalledWith(2025);
  });

  it("gives two pickers on one page their own label links, so each label names only its own select", () => {
    render(
      <>
        <YearPicker onChange={() => undefined} testId="first" value={2026} years={[2026]} />
        <YearPicker onChange={() => undefined} testId="second" value={2025} years={[2025]} />
      </>,
    );

    expect(screen.getAllByRole("combobox", { name: "Season" })).toEqual([screen.getByTestId("first"), screen.getByTestId("second")]);
  });
});
