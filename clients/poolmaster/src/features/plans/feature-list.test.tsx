import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FeatureList } from './feature-list';
import { FeatureMark } from './feature-mark';

describe('FeatureList', () => {
  it('lists what a plan includes under its small-caps label, each behind a primary tick in the body colour', () => {
    render(<FeatureList features={['Championships', 'Custom entry limits']} label="Everything in Pro, plus" mark={FeatureMark.INCLUDED} testId="list" />);

    expect(screen.getByText('Everything in Pro, plus')).toHaveClass('uppercase', 'text-muted-foreground');
    const items = within(screen.getByTestId('list-items')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Championships', 'Custom entry limits']);
    items.forEach((item) => {
      expect(within(item).getByTestId('list-mark')).toHaveClass('text-primary', 'lucide-check');
      expect(within(item).getByText(/./)).toHaveClass('text-foreground');
    });
  });

  it('lists what a lower plan hides behind muted dashes, the features muted too', () => {
    render(<FeatureList features={['Championships']} label="Hidden on Free" mark={FeatureMark.REMOVED} testId="list" />);

    const item = within(screen.getByTestId('list-items')).getByRole('listitem');
    expect(within(item).getByTestId('list-mark')).toHaveClass('text-muted-foreground', 'lucide-minus');
    expect(within(item).getByText('Championships')).toHaveClass('text-muted-foreground');
  });

  it('puts one help icon beside the label when given', () => {
    render(<FeatureList features={[]} label="Hidden on Free" testId="list" labelAside={<button type="button">Help</button>} mark={FeatureMark.REMOVED} />);

    expect(within(screen.getByTestId('list-label')).getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });
});
