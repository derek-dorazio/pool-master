import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Eyebrow } from './eyebrow';

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
