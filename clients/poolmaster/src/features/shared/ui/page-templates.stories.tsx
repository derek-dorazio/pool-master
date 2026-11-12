import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { FormField, Input } from "./form-field";
import { FormEditorSection, PublicInviteJoinPage } from "./page-templates";
import { Text } from "./text";

const meta = {
  title: "Page/Templates",
  component: FormEditorSection,
} satisfies Meta<typeof FormEditorSection>;

export default meta;

export const EditorSection: StoryObj = {
  render: () => (
    <FormEditorSection footer={<Button>Save</Button>} title="Scoring">
      <FormField label="Scores that count"><Input defaultValue="4" /></FormField>
    </FormEditorSection>
  ),
};

export const InviteJoin: StoryObj = {
  render: () => (
    <PublicInviteJoinPage
      context={<Text variant="meta">Sam Rivera invited you</Text>}
      primaryAction={<Button>Join league</Button>}
      secondaryAction={<Button variant="ghost">Not now</Button>}
      title="Join Weekend Warriors"
    >
      <Text>24 members · Golf</Text>
    </PublicInviteJoinPage>
  ),
};
