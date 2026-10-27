import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cn } from './class-names';
import { Eyebrow } from './eyebrow';
import { Chip } from './status-badge';

describe('Eyebrow', () => {
  it('sets the line over a title in the accent colour with the theme eyebrow spacing', () => {
    render(<Eyebrow>Up next</Eyebrow>);

    expect(screen.getByText('Up next')).toHaveClass('uppercase', 'tracking-eyebrow', 'text-primary');
  });

  it('sets a menu group name in the muted colour', () => {
    render(<Eyebrow tone="muted">Sports</Eyebrow>);

    expect(screen.getByText('Sports')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('Sports')).not.toHaveClass('text-primary');
  });
});

describe('theme letter spacing in class merges', () => {
  it('lets a later tracking class replace the theme eyebrow spacing, so a chip reads in normal spacing', () => {
    expect(cn('tracking-eyebrow', 'tracking-normal')).toBe('tracking-normal');

    render(<Chip>Pro</Chip>);
    expect(screen.getByText('Pro')).toHaveClass('tracking-normal');
    expect(screen.getByText('Pro')).not.toHaveClass('tracking-eyebrow');
  });
});
