import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Selector,
} from "./dropdown-menu";

describe("pool-master-3lo.9: shared dropdown menu and selector primitives", () => {
  it("rule: renders shared dropdown menu surface and items", async () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Profile</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.getByText("Profile")).toBeInTheDocument();
  });

  it("rule: renders selector changes through caller callback", () => {
    const handleChange = vi.fn();

    render(
      <Selector
        aria-label="Lifecycle"
        onChange={handleChange}
        options={[
          { label: "Active", value: "active" },
          { label: "Inactive", value: "inactive" },
        ]}
        value="active"
      />,
    );

    fireEvent.change(screen.getByLabelText("Lifecycle"), {
      target: { value: "inactive" },
    });

    expect(handleChange).toHaveBeenCalledWith("inactive");
  });
});
