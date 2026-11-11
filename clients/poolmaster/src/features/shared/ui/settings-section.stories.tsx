import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { SectionCard } from "./section-card";
import { DangerZoneAction, SettingsRow, SettingsRows } from "./settings-section";

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
