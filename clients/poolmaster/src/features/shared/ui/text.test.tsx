import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Text } from './text';

describe('Text', () => {
  it('sets running text small in the colour of the text around it, as a span by default', () => {
    render(<Text>Picks lock at the first tee time.</Text>);

    const text = screen.getByText('Picks lock at the first tee time.');
    expect(text.tagName).toBe('SPAN');
    expect(text).toHaveClass('text-sm');
    expect(text.className).not.toMatch(/text-(foreground|muted-foreground)/);
  });

  it('sets a meta line small and muted', () => {
    render(<Text variant="meta">12 members · 2 active contests</Text>);

    expect(screen.getByText('12 members · 2 active contests')).toHaveClass('text-sm', 'text-muted-foreground');
  });

  it('sets a caption extra small and muted', () => {
    render(<Text variant="caption">Updated 2 minutes ago</Text>);

    expect(screen.getByText('Updated 2 minutes ago')).toHaveClass('text-xs', 'text-muted-foreground');
  });

  it('sets a column label in the muted uppercase eyebrow look', () => {
    render(<Text variant="label">Score</Text>);

    expect(screen.getByText('Score')).toHaveClass('text-xs', 'font-semibold', 'uppercase', 'tracking-eyebrow', 'text-muted-foreground');
  });

  it('sets a number with lined-up digits', () => {
    render(<Text variant="value">-12</Text>);

    expect(screen.getByText('-12')).toHaveClass('tabular-nums', 'font-medium', 'text-foreground');
  });

  it('sets a place numeral large and heaviest in the display face, in the colour of what it sits on', () => {
    render(<Text variant="numeral">1</Text>);

    const numeral = screen.getByText('1');
    expect(numeral).toHaveClass('font-display', 'font-black', 'text-xl');
    expect(numeral.className).not.toMatch(/text-(foreground|muted)/);
  });

  it('sets a leading name medium weight in the foreground colour', () => {
    render(<Text variant="strong">Birdie Hunters 2</Text>);

    expect(screen.getByText('Birdie Hunters 2')).toHaveClass('font-medium', 'text-foreground');
  });

  it.each([
    ['danger', 'text-destructive'],
    ['primary', 'text-primary'],
    ['default', 'text-foreground'],
  ] as const)("replaces the meta line's muted colour with the %s tone", (tone, className) => {
    render(<Text tone={tone} variant="meta">Line</Text>);

    expect(screen.getByText('Line')).toHaveClass(className);
    expect(screen.getByText('Line')).not.toHaveClass('text-muted-foreground');
  });

  it('mutes a body line when given the muted tone', () => {
    render(<Text tone="muted">Quiet line</Text>);

    expect(screen.getByText('Quiet line')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('Quiet line')).not.toHaveClass('text-foreground');
  });

  it.each(['semibold', 'bold', 'normal'] as const)('sets a %s weight in place of the variant\'s own, for names and points that stand out', (weight) => {
    render(<Text variant="strong" weight={weight}>Casey Crushers</Text>);

    expect(screen.getByText('Casey Crushers')).toHaveClass(`font-${weight}`);
    expect(screen.getByText('Casey Crushers')).not.toHaveClass('font-medium');
  });

  it('gives running text no weight class of its own, so it reads at the normal weight', () => {
    render(<Text>Plain words</Text>);

    expect(screen.getByText('Plain words').className).not.toMatch(/font-/);
  });

  it('keeps the size of the text around it when asked, for a name inside a larger line', () => {
    render(<Text size="inherit" variant="strong">Casey Crushers</Text>);

    expect(screen.getByText('Casey Crushers').className).not.toMatch(/text-(xs|sm|base|lg)/);
  });

  it.each(['xs', 'base', 'lg'] as const)('sets the %s size in place of the variant\'s own', (size) => {
    render(<Text size={size} variant="value">42</Text>);

    expect(screen.getByText('42')).toHaveClass(`text-${size}`);
    expect(screen.getByText('42')).not.toHaveClass('text-sm');
  });

  it('cuts a long line short with an ellipsis when asked', () => {
    render(<Text truncate>A very long entry name</Text>);

    expect(screen.getByText('A very long entry name')).toHaveClass('truncate');
  });

  it('styles its child instead when asked, so a linked name keeps the look', () => {
    render(
      <MemoryRouter>
        <Text asChild variant="strong" weight="semibold"><Link to="/teams/1">Casey Crushers</Link></Text>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Casey Crushers' });
    expect(link).toHaveAttribute('href', '/teams/1');
    expect(link).toHaveClass('font-semibold', 'text-foreground');
  });

  it('renders as the element asked for, such as a paragraph', () => {
    render(<Text as="p">A paragraph</Text>);

    expect(screen.getByText('A paragraph').tagName).toBe('P');
  });
  it('sets the brand wordmark in the display face, black italic capitals on the dark band', () => {
    render(<Text variant="wordmark">Primetime</Text>);

    expect(screen.getByText('Primetime')).toHaveClass('font-display', 'font-black', 'italic', 'uppercase', 'text-on-inverse');
  });

  it('sets header links and the "League" caption in display capitals on the dark band', () => {
    render(
      <>
        <Text variant="nav">Plans</Text>
        <Text variant="displayLabel">League</Text>
      </>,
    );

    expect(screen.getByText('Plans')).toHaveClass('font-display', 'font-bold', 'uppercase', 'tracking-button', 'text-on-inverse');
    expect(screen.getByText('League')).toHaveClass('font-display', 'text-xs', 'tracking-label', 'text-label-on-inverse');
  });

  it('sets a display-face name in the colour of the text around it', () => {
    render(<Text size="base" variant="display">Office Pool</Text>);

    const name = screen.getByText('Office Pool');
    expect(name).toHaveClass('font-display', 'font-bold', 'text-base');
    expect(name.className).not.toMatch(/text-(foreground|muted|on-inverse)/);
  });

  it('turns gold on hover, or on hover or focus of its group link, when given a primary hover tone', () => {
    render(<Text hoverTone="primary" variant="wordmark">Primetime</Text>);

    expect(screen.getByText('Primetime')).toHaveClass('hover:text-primary', 'group-hover:text-primary', 'group-focus-visible:text-primary');
  });

  it('sets no hover colour unless asked', () => {
    render(<Text variant="meta">Plans</Text>);

    expect(screen.getByText('Plans').className).not.toMatch(/hover:/);
  });
});
