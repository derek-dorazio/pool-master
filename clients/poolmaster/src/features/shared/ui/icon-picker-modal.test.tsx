import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { IconPickerModal } from "./icon-picker-modal";

const iconOptions = [
  { key: "alpha", label: "Alpha Icon" },
  { key: "beta", label: "Beta Icon" },
  { key: "gamma", label: "Gamma Icon" },
] as const;

function renderIconPicker(overrides: Partial<Parameters<typeof IconPickerModal<string, (typeof iconOptions)[number]>>[0]> = {}) {
  return render(
    <IconPickerModal
      canSave
      canSelect
      closeLabel="Close icon picker"
      description="Choose an icon."
      descriptionId="icon-picker-description"
      isPending={false}
      modalTestId="icon-picker-modal"
      onCancel={vi.fn()}
      onOpenChange={vi.fn()}
      onSave={vi.fn()}
      onSelect={vi.fn()}
      open
      optionTestIdPrefix="icon-option"
      options={iconOptions}
      paletteTestId="icon-palette"
      renderOptionIcon={(option) => <span aria-hidden>{option.key}</span>}
      renderSelectedIcon={() => <span aria-hidden>selected</span>}
      saveTestId="icon-save"
      selectedLabel="Beta Icon"
      title="Change icon"
      value="beta"
      {...overrides}
    />,
  );
}

type TestIconKey = (typeof iconOptions)[number]["key"];

describe("pool-master-dn4.4: shared IconPickerModal", () => {
  it("renders selected preview, scroll-safe palette, and selectable options", () => {
    const handleSelect = vi.fn();
    renderIconPicker({ onSelect: handleSelect });

    expect(screen.getByTestId("icon-picker-modal")).toHaveTextContent("Beta Icon");
    expect(screen.getByTestId("icon-palette")).toHaveClass("max-h-80", "overflow-y-auto", "sm:grid-cols-4");
    expect(screen.getByTestId("icon-option-beta")).toHaveClass("border-primary");

    fireEvent.click(screen.getByTestId("icon-option-alpha"));
    expect(handleSelect).toHaveBeenCalledWith("alpha");
  });

  it("dispatches cancel and save actions", () => {
    const handleCancel = vi.fn();
    const handleSave = vi.fn();
    renderIconPicker({ onCancel: handleCancel, onSave: handleSave });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByTestId("icon-save"));

    expect(handleCancel).toHaveBeenCalledTimes(1);
    expect(handleSave).toHaveBeenCalledTimes(1);
  });

  it("supports disabled selection, pending save state, and error messages", () => {
    renderIconPicker({
      canSave: false,
      canSelect: false,
      errorMessage: "Could not save icon.",
      isPending: true,
    });

    expect(screen.getByTestId("icon-option-alpha")).toBeDisabled();
    expect(screen.getByTestId("icon-save")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByText("Saving...")).toBeInTheDocument();
    expect(screen.getByText("Could not save icon.")).toBeInTheDocument();
  });

  it("pool-master-dxd.25 exposes keyboard-friendly dialog state and selected option semantics", async () => {
    const user = userEvent.setup();
    const handleOpenChange = vi.fn();
    const handleCancel = vi.fn();

    renderIconPicker({
      onCancel: handleCancel,
      onOpenChange: handleOpenChange,
    });

    expect(screen.getByRole("dialog", { name: "Change icon" })).toBeInTheDocument();
    expect(screen.getByText("Choose an icon.")).toHaveAttribute("id", "icon-picker-description");
    expect(screen.getByTestId("icon-option-beta")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("icon-option-alpha")).toHaveAttribute("aria-pressed", "false");

    await user.tab();
    expect(document.activeElement).toBeInstanceOf(HTMLElement);

    await user.keyboard("{Escape}");
    expect(handleCancel).toHaveBeenCalledTimes(1);
    expect(handleOpenChange).toHaveBeenCalledWith(false);
  });

  it("pool-master-dxd.25 returns focus to the external trigger when the picker closes", async () => {
    const user = userEvent.setup();

    function IconPickerHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Change icon
          </button>
          <IconPickerModal
            canSave
            canSelect
            closeLabel="Close icon picker"
            description="Choose an icon."
            descriptionId="icon-picker-description"
            isPending={false}
            modalTestId="icon-picker-modal"
            onCancel={() => setOpen(false)}
            onOpenChange={setOpen}
            onSave={vi.fn()}
            onSelect={vi.fn()}
            open={open}
            optionTestIdPrefix="icon-option"
            options={iconOptions}
            paletteTestId="icon-palette"
            renderOptionIcon={(option) => <span aria-hidden>{option.key}</span>}
            renderSelectedIcon={() => <span aria-hidden>selected</span>}
            saveTestId="icon-save"
            selectedLabel="Beta Icon"
            title="Change icon"
            value={"beta" as TestIconKey}
          />
        </>
      );
    }

    render(<IconPickerHarness />);

    const trigger = screen.getByRole("button", { name: "Change icon" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Change icon" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Change icon" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
