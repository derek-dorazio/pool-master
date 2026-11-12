import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { SectionCard } from "./section-card";
import { DangerZoneAction, SettingsRow, SettingsRows, SettingsSection } from "./settings-section";
import { Switch } from "./switch";

const meta = {
  title: "Sections/SettingsRows",
  component: SettingsRows,
  args: { children: null },
} satisfies Meta<typeof SettingsRows>;

export default meta;
type Story = StoryObj<typeof meta>;

/** "See it, then Edit": each setting's current value in a SectionCard, the edit action beside it. */
export const SeeItThenEdit: Story = {
  args: {
    children: (
      <>
        <SettingsRow label="Name" value="Weekend Warriors" />
        <SettingsRow label="Sport" value="Golf" />
        <SettingsRow action={<Button size="sm" variant="ghost">Change</Button>} label="Plan" value="Pro" />
      </>
    ),
  },
  decorators: [(Story) => (
    <SectionCard title="League details" trailing={<Button size="sm" variant="secondary">Edit</Button>}>
      <Story />
    </SectionCard>
  )],
};

/** A danger zone: a SectionCard with `tone="danger"` holding DangerZoneAction rows. */
export const DangerZone: Story = {
  args: {
    children: (
      <DangerZoneAction
        action={<Button variant="danger">Delete league</Button>}
        description="Removes every contest, entry and member. This cannot be undone."
        title="Delete this league"
      />
    ),
  },
  decorators: [(Story) => <SectionCard tone="danger"><Story /></SectionCard>],
};

/** A settings section: values left to right on one line, Edit in the title, a row's own action at its end. */
export const Section: Story = {
  args: { children: null },
  render: () => (
    <div className="max-w-xl space-y-4">
      <SettingsSection onEdit={() => undefined} title="Profile">
        <SettingsRow label="Name" value="Sam Lee" />
        <SettingsRow label="Email" value="sam@example.com" />
        <SettingsRow label="Username" value="samlee" />
      </SettingsSection>
      <SettingsSection help="Invitations and account emails are always sent." title="Email notifications">
        <SettingsRow action={<Switch checked label="Results" onCheckedChange={() => undefined} />} label="Results" />
        <SettingsRow action={<Switch checked={false} label="Live standings" onCheckedChange={() => undefined} />} label="Live standings" />
      </SettingsSection>
      <SettingsSection title="Account" tone="danger">
        <SettingsRow action={<Button size="sm" variant="secondary">Inactivate</Button>} label="Hide me from my leagues" />
        <SettingsRow action={<Button disabled size="sm" variant="danger">Delete</Button>} label="Delete account" />
      </SettingsSection>
    </div>
  ),
};
