import type { Meta, StoryObj } from "@storybook/react-vite";
import { Crown, Flag, Shield, Star } from "lucide-react";
import { useState } from "react";
import { IconPalette } from "./icon-palette";

const ICONS = { crown: Crown, flag: Flag, shield: Shield, star: Star } as const;
type IconKey = keyof typeof ICONS;
const OPTIONS: { key: IconKey; label: string }[] = [
  { key: "crown", label: "Crown" },
  { key: "flag", label: "Flag" },
  { key: "shield", label: "Shield" },
  { key: "star", label: "Star" },
];

function PaletteDemo() {
  const [value, setValue] = useState<IconKey>("crown");
  return (
    <IconPalette
      aria-label="Team icon"
      onSelect={setValue}
      optionTestIdPrefix="icon"
      options={OPTIONS}
      renderOptionIcon={(option) => {
        const Glyph = ICONS[option.key];
        return <Glyph aria-hidden size={20} />;
      }}
      testId="story-palette"
      value={value}
    />
  );
}

const meta = {
  title: "Forms/IconPalette",
  component: PaletteDemo,
} satisfies Meta<typeof PaletteDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
