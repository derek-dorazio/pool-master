import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DangerZone, DangerZoneAction, SettingsRow, SettingsSection } from "./settings-section";

describe("SettingsSection", () => {
  it("shows its title as a heading with its description and optional action", () => {
    render(
      <SettingsSection
        action={<button type="button">Edit</button>}
        description="How the league appears to members."
        title="Profile"
      >
        <SettingsRow label="Name" value="Saturday Golf League" />
      </SettingsSection>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("How the league appears to members.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("renders no description paragraph when none is given", () => {
    render(
      <SettingsSection title="Profile">
        <SettingsRow label="Name" value="Saturday Golf League" />
      </SettingsSection>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
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

describe("DangerZone", () => {
  it("titles itself \"Danger zone\" with the default confirm description when none is given", () => {
    render(
      <DangerZone>
        <DangerZoneAction
          action={<button type="button">Delete league</button>}
          description="Removes the league and every contest in it."
          title="Delete this league"
        />
      </DangerZone>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Danger zone" })).toBeInTheDocument();
    expect(screen.getByText("Each of these asks you to confirm.")).toBeInTheDocument();
  });

  it("uses a custom title and description when given", () => {
    render(
      <DangerZone description="Cannot be undone." title="Leave league">
        <span>content</span>
      </DangerZone>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Leave league" })).toBeInTheDocument();
    expect(screen.getByText("Cannot be undone.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Danger zone" })).not.toBeInTheDocument();
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
