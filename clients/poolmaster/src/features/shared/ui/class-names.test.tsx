import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cn } from './class-names';
import { Chip } from './status-badge';

describe('theme letter spacing in class merges', () => {
  it('lets a later tracking class replace the theme eyebrow spacing, so a chip reads in normal spacing', () => {
    expect(cn('tracking-eyebrow', 'tracking-normal')).toBe('tracking-normal');

    render(<Chip>Pro</Chip>);
    expect(screen.getByText('Pro')).toHaveClass('tracking-normal');
    expect(screen.getByText('Pro')).not.toHaveClass('tracking-eyebrow');
  });
});
