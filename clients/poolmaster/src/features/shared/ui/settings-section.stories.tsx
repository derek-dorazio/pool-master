import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { DangerZone, DangerZoneAction, SettingsRow, SettingsSection, SettingsSectionHeader } from "./settings-section";

const meta = {
  title: "Sections/SettingsSection",
  component: SettingsSection,
  args: { title: "League details", children: null },
} satisfies Meta<typeof SettingsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** "See it, then Edit": each setting's current value, with the edit action beside it. */
export const SeeItThenEdit: Story = {
  args: {
    action: <Button size="sm" variant="secondary">Edit</Button>,
    children: (
      <>
        <SettingsRow label="Name" value="Weekend Warriors" />
        <SettingsRow label="Sport" value="Golf" />
        <SettingsRow action={<Button size="sm" variant="ghost">Change</Button>} label="Plan" value="Pro" />
      </>
    ),
  },
};

export const HeaderAlone: StoryObj = {
  render: () => <SettingsSectionHeader action={<Button size="sm">Add</Button>} title="Members" />,
};

export const Danger: StoryObj = {
  render: () => (
    <DangerZone>
      <DangerZoneAction
        action={<Button variant="danger">Delete league</Button>}
        description="Removes every contest, entry and member. This cannot be undone."
        title="Delete this league"
      />
    </DangerZone>
  ),
};
