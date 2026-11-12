import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconPalette } from "./icon-palette";

type IconKey = "flag" | "trophy" | "star";

const options = [
  { key: "flag", label: "Flag" },
  { key: "trophy", label: "Trophy" },
  { key: "star", label: "Star" },
] as const satisfies ReadonlyArray<{ key: IconKey; label: string }>;

function renderPalette({
  disabled,
  iconTone,
  onSelect = vi.fn(),
  value = "trophy",
}: { disabled?: boolean; iconTone?: "primary"; onSelect?: (key: IconKey) => void; value?: IconKey } = {}) {
  render(
    <IconPalette<IconKey, (typeof options)[number]>
      aria-label="League icon"
      disabled={disabled}
      iconTone={iconTone}
      onSelect={onSelect}
      optionTestIdPrefix="league-icon"
      options={options}
      renderOptionIcon={() => <span aria-hidden>*</span>}
      testId="league-icon-palette"
      value={value}
    />,
  );
  return { onSelect };
}

describe("IconPalette", () => {
  it("renders one toggle button per option inside the labelled group", () => {
    renderPalette();

    const group = screen.getByRole("group", { name: "League icon" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(within(group).getByRole("button", { name: "Flag" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Trophy" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Star" })).toBeInTheDocument();
  });

  it("marks only the selected option as pressed", () => {
    renderPalette({ value: "trophy" });

    expect(screen.getByRole("button", { name: "Trophy" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Flag" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Star" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the clicked option's key through onSelect", () => {
    const { onSelect } = renderPalette();

    fireEvent.click(screen.getByRole("button", { name: "Star" }));

    expect(onSelect).toHaveBeenCalledWith("star");
  });

  it("disables every option when disabled", () => {
    renderPalette({ disabled: true });

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("sizes its columns to the container rather than the viewport, so a narrow card cannot squeeze tiles below a readable width", () => {
    renderPalette();

    const group = screen.getByRole("group", { name: "League icon" });
    expect(group).toHaveClass("grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]");
    expect(group.className).not.toMatch(/\b(sm|md|lg|xl):grid-cols-/);
  });

  it("draws each icon in the brand colour when iconTone is primary", () => {
    renderPalette({ iconTone: "primary" });
    expect(screen.getByTestId("league-icon-flag-icon")).toHaveClass("text-primary");
  });

  it("leaves each icon's own colour alone when no iconTone is given", () => {
    renderPalette();
    expect(screen.getByTestId("league-icon-flag-icon")).not.toHaveClass("text-primary");
  });
});
