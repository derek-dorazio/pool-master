import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DropdownMenu,
  DropdownMenuCheck,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function LeagueSwitcher() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Switch league" testId="story-menu">Weekend Warriors</DropdownMenuTrigger>
      <DropdownMenuContent testId="story-menu-content" width="md">
        <DropdownMenuLabel>Your leagues</DropdownMenuLabel>
        <DropdownMenuItem isSelected>
          <DropdownMenuItemText detail="Golf · 24 members" name="Weekend Warriors" />
          <DropdownMenuCheck />
        </DropdownMenuItem>
        <DropdownMenuItem>
          <DropdownMenuItemText detail="Football · 12 members" name="Office Pool" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <DropdownMenuItemText isMuted name="Join a league" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const meta = {
  title: "Navigation/DropdownMenu",
  component: LeagueSwitcher,
} satisfies Meta<typeof LeagueSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens on click, tap or keys; never on hover. */
export const Default: Story = {};
