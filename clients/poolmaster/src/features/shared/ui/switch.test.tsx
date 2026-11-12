import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./switch";

describe("Switch", () => {
  it("is a named switch that reports whether it is on", () => {
    render(<Switch checked label="Results" onCheckedChange={() => undefined} />);

    expect(screen.getByRole("switch", { name: "Results" })).toBeChecked();
  });

  it("asks to turn off when it is on and to turn on when it is off", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<Switch checked label="Results" onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);

    rerender(<Switch checked={false} label="Results" onCheckedChange={onCheckedChange} />);
    expect(screen.getByRole("switch")).not.toBeChecked();
    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
  });

  it("does nothing while disabled", () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked disabled label="Results" onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
