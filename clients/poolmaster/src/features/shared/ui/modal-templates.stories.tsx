import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
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
