import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterPicker } from "./filter-picker";

const OPTIONS = [
  { label: "All sports", value: "" },
  { label: "Golf", options: [{ label: "All golf", value: "golf" }, { label: "PGA TOUR", value: "golf/pga-tour" }] },
];

describe("FilterPicker", () => {
  it("names the select with its visible label and offers flat choices and named groups in the order given", () => {
    render(<FilterPicker label="Sport" onChange={() => undefined} options={OPTIONS} testId="picker" value="golf" />);

    const picker = screen.getByRole("combobox", { name: "Sport" });
    expect(screen.getByText("Sport")).toBeVisible();
    expect(picker).toBe(screen.getByTestId("picker"));
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["All sports", "All golf", "PGA TOUR"]);
    expect(within(picker).getByRole("group", { name: "Golf" })).toContainElement(within(picker).getByRole("option", { name: "PGA TOUR" }));
    expect(picker).toHaveValue("golf");
  });

  it("hands the chosen value back as given", () => {
    const onChange = vi.fn();
    render(<FilterPicker label="Sport" onChange={onChange} options={OPTIONS} value="" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Sport" }), { target: { value: "golf/pga-tour" } });

    expect(onChange).toHaveBeenCalledWith("golf/pga-tour");
  });
});
