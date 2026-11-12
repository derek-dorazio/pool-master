import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DangerZoneAction, SettingsRow, SettingsRows } from "./settings-section";

describe("SettingsRows", () => {
  it("holds a section's settings rows in one divided list", () => {
    render(
      <SettingsRows testId="rows">
        <SettingsRow label="Name" testId="row-name" value="Saturday Golf League" />
        <SettingsRow label="Visibility" testId="row-visibility" value="Private" />
      </SettingsRows>,
    );

    const rows = screen.getByTestId("rows");
    expect(rows).toHaveClass("divide-y");
    expect(within(rows).getByTestId("row-name")).toHaveTextContent("Saturday Golf League");
    expect(within(rows).getByTestId("row-visibility")).toHaveTextContent("Private");
  });
});

describe("SettingsRow", () => {
  it("shows the setting's label, current value and trailing action", () => {
    render(
      <SettingsRow
        action={<button type="button">Change</button>}
        label="Visibility"
        testId="row-visibility"
        value="Private"
      />,
    );

    const row = screen.getByTestId("row-visibility");
    expect(within(row).getByText("Visibility")).toBeInTheDocument();
    expect(within(row).getByText("Private")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("renders no action control when none is given", () => {
    render(<SettingsRow label="Visibility" value="Private" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("DangerZoneAction", () => {
  it("shows the action's title, description and its control", () => {
    render(
      <DangerZoneAction
        action={<button type="button">Delete league</button>}
        description="Removes the league and every contest in it."
        testId="danger-delete"
        title="Delete this league"
      />,
    );

    const action = screen.getByTestId("danger-delete");
    expect(within(action).getByText("Delete this league")).toBeInTheDocument();
    expect(
      within(action).getByText("Removes the league and every contest in it."),
    ).toBeInTheDocument();
    expect(within(action).getByRole("button", { name: "Delete league" })).toBeInTheDocument();
  });
});
