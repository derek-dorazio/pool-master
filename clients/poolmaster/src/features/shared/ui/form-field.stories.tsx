import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox, FormField, Input, PasswordInput, Select, Textarea } from "./form-field";

const meta = {
  title: "Forms/FormField",
  component: FormField,
  args: { label: "Team name", children: <Input defaultValue="Weekend Warriors" /> },
} satisfies Meta<typeof FormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextInput: Story = {};
export const WithHelper: Story = { args: { helperText: "Members see this on every leaderboard." } };
export const WithError: Story = { args: { error: "That name is already taken." } };

export const Controls: StoryObj = {
  render: () => (
    <div className="grid max-w-md gap-4">
      <FormField label="Password"><PasswordInput defaultValue="hunter22" /></FormField>
      <FormField label="Sport">
        <Select defaultValue="golf">
          <option value="golf">Golf</option>
          <option value="football">Football</option>
        </Select>
      </FormField>
      <FormField label="Notes"><Textarea defaultValue="Bring snacks." /></FormField>
      <label className="flex items-center gap-2"><Checkbox defaultChecked /> Email me when picks open</label>
      <label className="flex items-center gap-2"><Checkbox indeterminate /> Some members</label>
    </div>
  ),
};
