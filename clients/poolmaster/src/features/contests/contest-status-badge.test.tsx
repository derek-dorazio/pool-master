import { render, screen } from '@testing-library/react';
import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import themeCss from '@/styles/globals.css?raw';
import { ContestStatusBadge } from './contest-status-badge';

// jsdom resolves no CSS variables, so read the theme file itself: a token resolves through
// `var(--…)` until it reaches a raw colour.
const themeTokens = new Map(
  [...themeCss.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
);

function resolveToken(name: string): string {
  const value = themeTokens.get(name) ?? '';
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  return reference ? resolveToken(reference[1]) : value;
}

/** The text and surface colours a status badge renders with, as raw theme values. */
function renderedColourOf(status: ContestStatus) {
  const { unmount } = render(<ContestStatusBadge status={status} />);
  const classes = [...screen.getByText(/\S/).classList];
  unmount();
  const tokenIn = (prefix: string) =>
    resolveToken(/var\((--[\w-]+)\)/.exec(classes.find((name) => name.startsWith(prefix)) ?? '')?.[1] ?? '');

  return { text: tokenIn('[color:'), surface: tokenIn('bg-[') };
}

describe('ContestStatusBadge', () => {
  it.each<[ContestStatus, string]>([
    [ContestStatus.ACTIVE, 'Live'],
    [ContestStatus.COMPLETED, 'Final'],
  ])('renders %s ("%s") in a text colour no other contest status renders', (status) => {
    const { text } = renderedColourOf(status);
    const others = Object.values(ContestStatus)
      .filter((other) => other !== status)
      .map((other) => renderedColourOf(other).text);

    expect(text).not.toBe('');
    expect(others).not.toContain(text);
  });

  it('renders Final as a solid surface, not one of the tinted surfaces every other status uses', () => {
    const { surface } = renderedColourOf(ContestStatus.COMPLETED);

    expect(surface).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
