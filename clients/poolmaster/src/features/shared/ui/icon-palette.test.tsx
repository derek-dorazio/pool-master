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
  onSelect = vi.fn(),
  value = "trophy",
}: { disabled?: boolean; onSelect?: (key: IconKey) => void; value?: IconKey } = {}) {
  render(
    <IconPalette<IconKey, (typeof options)[number]>
      aria-label="League icon"
      disabled={disabled}
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
});
