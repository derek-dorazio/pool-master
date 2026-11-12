import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField, Input } from "./form-field";
import { FormPage } from "./form-page";

const meta = {
  title: "Forms/FormPage",
  component: FormPage,
  args: {
    cancelTo: "/",
    children: (
      <>
        <FormField label="League name"><Input defaultValue="Weekend Warriors" /></FormField>
        <FormField label="Short name"><Input defaultValue="WW" /></FormField>
        <FormField label="Time zone"><Input defaultValue="Eastern" /></FormField>
        <FormField label="Description"><Input defaultValue="Since 2019" /></FormField>
      </>
    ),
    isPending: false,
    onSubmit: (event) => event.preventDefault(),
    pendingLabel: "Saving",
    submitLabel: "Save",
    title: "Edit league",
  },
} satisfies Meta<typeof FormPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A full-page edit, for more than three fields; three or fewer go in a `FormModal`. */
export const Default: Story = {};
export const Saving: Story = { args: { isPending: true } };
export const Failed: Story = { args: { errorMessage: "We couldn't save the league. Try again." } };
