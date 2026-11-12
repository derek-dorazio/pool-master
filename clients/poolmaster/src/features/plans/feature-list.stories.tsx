import type { Meta, StoryObj } from '@storybook/react-vite';
import { FeatureList } from './feature-list';
import { FeatureMark } from './feature-mark';

const meta = {
  title: 'Plans/FeatureList',
  component: FeatureList,
  args: {
    features: ['Championships with custom points', 'Up to 10 sports leagues a year'],
    label: 'Everything in Pro, plus',
    mark: FeatureMark.INCLUDED,
  },
} satisfies Meta<typeof FeatureList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What a plan adds, on its plan card: primary ticks. */
export const Included: Story = {};

/** What a lower plan hides, on the move-down check: muted dashes and muted names. */
export const Removed: Story = {
  args: { features: ['Championships', 'Custom entry limits'], label: 'Hidden on Free', mark: FeatureMark.REMOVED },
};
