import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Eyebrow } from './eyebrow';

describe('Eyebrow', () => {
  it('sets the line over a title in label blue with the theme eyebrow spacing', () => {
    render(<Eyebrow>Up next</Eyebrow>);

    expect(screen.getByText('Up next')).toHaveClass('uppercase', 'tracking-eyebrow', 'text-label');
  });

  it('sets a menu group name in the muted colour', () => {
    render(<Eyebrow tone="muted">Sports</Eyebrow>);

    expect(screen.getByText('Sports')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('Sports')).not.toHaveClass('text-label');
  });

  it('sets the line over a title on a navy panel in the light label colour, so it stays readable', () => {
    render(<Eyebrow tone="inverse">Open for entries</Eyebrow>);

    expect(screen.getByText('Open for entries')).toHaveClass('text-label-on-inverse');
    expect(screen.getByText('Open for entries')).not.toHaveClass('text-label');
  });
});
