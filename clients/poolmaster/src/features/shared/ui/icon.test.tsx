import { render, screen } from '@testing-library/react';
import { Award } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Icon } from './icon';

describe('Icon', () => {
  it('draws the icon hidden from screen readers, in the colour of the text around it by default', () => {
    render(<Icon data-testid="award" icon={Award} size={16} />);

    const icon = screen.getByTestId('award');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).not.toHaveClass('text-foreground', 'text-muted-foreground', 'text-primary');
    expect(icon).toHaveAttribute('width', '16');
  });

  it.each([
    ['muted', 'text-muted-foreground'],
    ['primary', 'text-primary'],
    ['danger', 'text-destructive'],
    ['default', 'text-foreground'],
  ] as const)('colours the icon in the %s tone', (tone, className) => {
    render(<Icon data-testid="award" icon={Award} tone={tone} />);

    expect(screen.getByTestId('award')).toHaveClass(className);
  });

  it('sits inline before the words that follow it, with a small gap', () => {
    render(<Icon data-testid="award" icon={Award} inline />);

    expect(screen.getByTestId('award')).toHaveClass('inline', 'mr-2');
  });
});
