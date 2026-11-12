import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DangerZoneAction, SettingsRow, SettingsRows, SettingsSection } from "./settings-section";

describe("SettingsSection", () => {
  it("shows each setting's current value under the section title, with no dialog open", () => {
    render(
      <SettingsSection testId="profile" title="Profile">
        <SettingsRow label="Name" testId="profile-name" value="Sam Lee" />
        <SettingsRow label="Username" testId="profile-username" value="samlee" />
      </SettingsSection>,
    );

    const section = screen.getByRole("region", { name: "Profile" });
    expect(within(section).getByTestId("profile-name")).toHaveTextContent("NameSam Lee");
    expect(within(section).getByTestId("profile-username")).toHaveTextContent("Usernamesamlee");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("puts one Edit button in the title, named for the section, that asks to open its dialog", () => {
    const onEdit = vi.fn();
    render(
      <SettingsSection editTestId="profile-edit" onEdit={onEdit} title="Profile">
        <SettingsRow label="Name" value="Sam Lee" />
      </SettingsSection>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Profile" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("profile-edit")).toHaveTextContent("Edit");
  });

  it("keeps a row's own action, such as a switch, at the row's end in place of a value", () => {
    render(
      <SettingsSection title="Email notifications">
        <SettingsRow action={<button type="button">Turn off</button>} label="Results" testId="results" />
      </SettingsSection>,
    );

    const row = screen.getByTestId("results");
    expect(row).toHaveClass("justify-between");
    expect(within(row).getByRole("button", { name: "Turn off" })).toBeInTheDocument();
  });

  it("draws a danger section with the danger title colour and the section's own help", () => {
    render(
      <SettingsSection help="Each of these asks you to confirm." testId="account" title="Account" tone="danger">
        <SettingsRow label="Delete account" value="Locked" />
      </SettingsSection>,
    );

    expect(screen.getByTestId("account")).toHaveClass("border-destructive/40");
    expect(screen.getByRole("heading", { name: "Account" })).toHaveClass("text-destructive");
    expect(screen.getByTestId("account-help")).toBeInTheDocument();
  });
});

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
