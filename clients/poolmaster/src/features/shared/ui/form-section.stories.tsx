import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormSection } from "./form-section";
import { Input } from "./form-field";

const meta = {
  title: "Forms/FormSection",
  component: FormSection,
  args: {
    children: <Input aria-label="Contest name" defaultValue="Masters Pool" />,
    help: "Filled from the event and format until you change it.",
    step: 4,
    title: "Name",
  },
} satisfies Meta<typeof FormSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A numbered step of a setup form. */
export const Numbered: Story = {};

/** A section of a form that is not a sequence. */
export const Unnumbered: Story = { args: { step: undefined, title: "Championship name" } };
