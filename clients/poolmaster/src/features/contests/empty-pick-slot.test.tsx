import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyPickSlot } from './empty-pick-slot';

describe('EmptyPickSlot', () => {
  it('stands in for an unknown side as a dashed line with 8px corners, carrying what fills it', () => {
    render(<EmptyPickSlot testId="slot">Winner of Game 1</EmptyPickSlot>);

    const slot = screen.getByTestId('slot');
    expect(slot).toHaveTextContent('Winner of Game 1');
    expect(slot).toHaveClass('border-dashed', 'rounded-lg');
  });
});
