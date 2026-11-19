import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./button";
import { FormField, Input } from "./form-field";
import { DetailEditModal, FormModal, PickerModal, ReadOnlyDetailModal } from "./modal-templates";
import { Text } from "./text";

const meta = {
  title: "Dialogs/FormModal",
  component: FormModal,
  args: {
    children: (
      <>
        <FormField label="Team name"><Input defaultValue="Weekend Warriors" /></FormField>
        <FormField label="Short name"><Input defaultValue="WW" /></FormField>
      </>
    ),
    onCancel: () => undefined,
    onOpenChange: () => undefined,
    onSave: () => undefined,
    open: true,
    saveLabel: "Save",
    title: "Edit team",
  },
} satisfies Meta<typeof FormModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An edit of three fields or fewer. Saving closes it and shows a toast. */
export const Default: Story = {};
export const Failed: Story = { args: { errorMessage: "We couldn't save the team." } };

const GOLFERS = [
  { id: "1", name: "Scottie Scheffler" },
  { id: "2", name: "Rory McIlroy" },
  { id: "3", name: "Xander Schauffele" },
];

function PickerDemo() {
  const [selected, setSelected] = useState<string | null>("2");
  return (
    <PickerModal
      getItemLabel={(golfer) => golfer.name}
      items={GOLFERS}
      onApply={() => undefined}
      onCancel={() => undefined}
      onOpenChange={() => undefined}
      onSelect={(golfer) => setSelected(golfer.id)}
      open
      selectedId={selected}
      title="Swap golfer"
    />
  );
}

export const Picker: StoryObj = { render: () => <PickerDemo /> };

export const ReadOnlyDetail: StoryObj = {
  render: () => (
    <ReadOnlyDetailModal
      detailContent={<Text>Sent 2 minutes ago.</Text>}
      details={[{ id: "to", label: "To", value: "sam@example.com" }]}
      onCancel={() => undefined}
      onOpenChange={() => undefined}
      open
      title="Invitation"
    />
  ),
};

/** A look-only dialog with one action that changes nothing, such as checking a provider again. */
export const ReadOnlyWithAction: StoryObj = {
  render: () => (
    <ReadOnlyDetailModal
      action={{ label: "Check now", onClick: () => undefined }}
      detailContent={<Text>No Edit: the key and the rate are set in Terraform.</Text>}
      details={[
        { id: "status", label: "Status", value: "Up" },
        { id: "rate", label: "Requests a minute", value: 5 },
      ]}
      onCancel={() => undefined}
      onOpenChange={() => undefined}
      open
      title="BALLDONTLIE"
    />
  ),
};

function DetailEditDemo() {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [days, setDays] = useState("3");
  return (
    <DetailEditModal
      facts={[
        { id: "status", label: "Status", value: "On" },
        { id: "auto-release", label: "Auto release", value: `${days} days before start` },
      ]}
      mode={mode}
      onCancel={() => setMode("view")}
      onCancelEdit={() => setMode("view")}
      onEdit={() => setMode("edit")}
      onOpenChange={() => undefined}
      onSave={() => setMode("view")}
      open
      saveLabel="Save"
      title={mode === "view" ? "MLB settings" : "MLB settings · Edit"}
    >
      <FormField label="Auto release (days before start)">
        <Input onChange={(event) => setDays(event.target.value)} value={days} />
      </FormField>
    </DetailEditModal>
  );
}

/** Settings open as facts with Close and Edit; Edit swaps in the form with Cancel and Save. */
export const DetailEdit: StoryObj = { render: () => <DetailEditDemo /> };

/** A view with buttons of its own between Close and Edit, such as an email's Preview and Send me this email. */
export const DetailEditWithViewActions: StoryObj = {
  render: () => (
    <DetailEditModal
      facts={[
        { id: "audience", label: "Audience", value: "Members" },
        { id: "status", label: "Status", value: "On" },
      ]}
      mode="view"
      onCancel={() => undefined}
      onCancelEdit={() => undefined}
      onEdit={() => undefined}
      onOpenChange={() => undefined}
      onSave={() => undefined}
      open
      saveLabel="Save"
      title="Final results"
      viewActions={(
        <>
          <Button type="button" variant="secondary">Preview</Button>
          <Button type="button" variant="secondary">Send me this email</Button>
        </>
      )}
    >
      {null}
    </DetailEditModal>
  ),
};

/** A thing's dialog with a Details section and an Actions section, each action with its line and button. */
export const DetailEditWithActions: StoryObj = {
  render: () => (
    <DetailEditModal
      actions={[
        { id: "reset", name: "Reset password", description: "Makes a temporary password to give them.", control: <Button size="sm" variant="secondary">Reset password</Button> },
        { id: "deactivate", name: "Deactivate", description: "Signs them out and blocks sign-in. Reversible.", control: <Button size="sm" variant="danger">Deactivate</Button> },
      ]}
      facts={[
        { id: "email", label: "Email", value: "ana@example.com" },
        { id: "role", label: "Role", value: "Member" },
      ]}
      mode="view"
      onCancel={() => undefined}
      onCancelEdit={() => undefined}
      onEdit={() => undefined}
      onOpenChange={() => undefined}
      onSave={() => undefined}
      open
      saveLabel="Save"
      title="Ana Ruiz"
    >
      {null}
    </DetailEditModal>
  ),
};
