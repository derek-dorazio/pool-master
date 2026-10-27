import { BRAND_COLORS, colorWithAlpha } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import themeCss from './globals.css?raw';

const themeTokens = new Map(
  [...themeCss.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
);

/** A token's raw value, following `var(--…)` until it reaches one. */
function resolveToken(name: string): string | undefined {
  const value = themeTokens.get(name);
  const reference = value === undefined ? null : /^var\((--[\w-]+)\)$/.exec(value);
  return reference ? resolveToken(reference[1]) : value;
}

/** The theme token each shared brand colour mirrors. */
const THEME_TOKEN_OF: Record<keyof typeof BRAND_COLORS, string> = {
  navy: '--color-navy-600',
  navyDeep: '--color-navy-800',
  navyMist: '--color-navy-100',
  navyHaze: '--color-navy-200',
  gold: '--color-gold-400',
  goldLight: '--color-gold-200',
  red: '--color-red-400',
  paper: '--color-paper',
  raised: '--surface-raised',
  onInverse: '--text-on-inverse',
  ink: '--color-ink',
  muted: '--text-muted',
};

describe('brand colours', () => {
  it.each(Object.entries(THEME_TOKEN_OF))(
    'BRAND_COLORS.%s matches the theme file, so email and link previews change with the app',
    (name, token) => {
      expect(resolveToken(token)?.toLowerCase()).toBe(BRAND_COLORS[name as keyof typeof BRAND_COLORS]);
    },
  );

  it('writes a brand colour at an alpha as rgba, the form email clients read', () => {
    expect(colorWithAlpha(BRAND_COLORS.navy, 0.1)).toBe('rgba(11, 30, 63, 0.10)');
  });

  it("sets the browser's tab colour to the brand navy", () => {
    expect(indexHtml).toContain(`<meta name="theme-color" content="${BRAND_COLORS.navy}" />`);
  });
});
