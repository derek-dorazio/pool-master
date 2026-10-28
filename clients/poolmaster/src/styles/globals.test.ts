import { describe, expect, it } from 'vitest';
import themeCss from './globals.css?raw';

const definedTokens = new Set([...themeCss.matchAll(/(--[\w-]+):/g)].map(([, name]) => name));
const referencedTokens = new Set([...themeCss.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name));

describe('theme file', () => {
  it('defines every token it references, so no setting silently falls back to the inherited colour', () => {
    const undefinedTokens = [...referencedTokens].filter((name) => !definedTokens.has(name));

    expect(undefinedTokens).toEqual([]);
  });

  it('gives small labels the light navy haze in dark mode, since label blue on navy is too dark to read', () => {
    const darkBlock = /\.dark \{([^}]*)\}/.exec(themeCss)?.[1] ?? '';

    expect(darkBlock).toMatch(/--text-label: var\(--color-navy-200\);/);
  });
});
