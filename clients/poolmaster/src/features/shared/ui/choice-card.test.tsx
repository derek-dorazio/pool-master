import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChoiceCard } from "./choice-card";

describe("ChoiceCard", () => {
  it("reads as a checked radio only when selected, and reports a click as the choice", () => {
    const onSelect = vi.fn();
    render(
      <div role="radiogroup">
        <ChoiceCard isSelected onSelect={vi.fn()} testId="choice-a">The Masters</ChoiceCard>
        <ChoiceCard isSelected={false} onSelect={onSelect} testId="choice-b">RBC Heritage</ChoiceCard>
      </div>,
    );

    expect(screen.getByRole("radio", { name: "The Masters" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "RBC Heritage" })).not.toBeChecked();

    fireEvent.click(screen.getByTestId("choice-b"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("ignores a click on a disabled card, so a choice that cannot be made is never reported", () => {
    const onSelect = vi.fn();
    render(
      <ChoiceCard isDisabled isSelected={false} onSelect={onSelect} testId="choice-budget">Budget</ChoiceCard>,
    );

    expect(screen.getByRole("radio", { name: "Budget" })).toBeDisabled();
    fireEvent.click(screen.getByTestId("choice-budget"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
