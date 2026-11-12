import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Switch, type SwitchProps } from "./switch";

const meta = {
  title: "Forms/Switch",
  component: Switch,
  args: { checked: true, label: "Contest updates", onCheckedChange: () => undefined },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

function FlippableSwitch(args: SwitchProps) {
  const [checked, setChecked] = useState(args.checked);
  return <Switch {...args} checked={checked} onCheckedChange={setChecked} />;
}

/** Flip it: a setting that saves the moment it changes. */
export const Interactive: Story = {
  render: (args) => <FlippableSwitch {...args} />,
};

export const Off: Story = { args: { checked: false } };

export const Disabled: Story = { args: { disabled: true } };
