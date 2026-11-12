import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ChoiceCard, ChoiceCardText } from "./choice-card";

const meta = {
  title: "Forms/ChoiceCard",
  component: ChoiceCard,
  args: { children: "Golf", isSelected: true, onSelect: () => undefined, testId: "story-choice" },
} satisfies Meta<typeof ChoiceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};
export const Disabled: Story = { args: { isDisabled: true, isSelected: false } };

function GroupDemo() {
  const [choice, setChoice] = useState("tiered");
  const options = [
    { key: "tiered", name: "Tiered picks", meta: "Pick one golfer from each tier" },
    { key: "salary", name: "Salary cap", meta: "Build a team under a budget" },
  ];
  return (
    <div className="grid gap-2" role="radiogroup">
      {options.map((option) => (
        <ChoiceCard isSelected={choice === option.key} key={option.key} onSelect={() => setChoice(option.key)} testId={option.key}>
          <ChoiceCardText description={option.meta} label={option.name} />
        </ChoiceCard>
      ))}
    </div>
  );
}

export const Group: StoryObj = { render: () => <GroupDemo /> };
