import { describe, expect, it } from 'vitest';
import themeCss from './globals.css?raw';

const definedTokens = new Set([...themeCss.matchAll(/(--[\w-]+):/g)].map(([, name]) => name));
const referencedTokens = new Set([...themeCss.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name));

/** The tokens a block sets, by name, with each one's value. */
function tokensIn(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const darkBlock = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/.exec(themeCss)?.[1] ?? '';
const darkTokens = tokensIn(darkBlock);
const lightTokens = tokensIn(themeCss.slice(0, themeCss.indexOf('@media (prefers-color-scheme: dark)')));

/** Tokens that are not colours: type, spacing, motion. */
const NOT_A_COLOUR = /^--(font|tracking|radius|ease|duration)/;

/**
 * Colour roles that are deliberately the same in both modes: the navy header bar and the text on
 * it, the dark text on gold, the silver and bronze medals, the deep shadows, and the orange and the
 * tennis ball in the drawings, which read on paper and graphite alike.
 */
const SAME_IN_BOTH_MODES = new Set([
  '--surface-inverse',
  '--surface-inverse-deep',
  '--text-on-inverse',
  '--text-on-inverse-muted',
  '--surface-on-inverse-subtle',
  '--surface-on-inverse-hover',
  '--border-on-inverse',
  '--status-final-surface',
  '--status-final-text',
  '--text-label-on-inverse',
  '--surface-selected',
  '--primary-foreground',
  '--accent-foreground',
  '--podium-1-text',
  '--podium-2-surface',
  '--podium-2-text',
  '--podium-3-surface',
  '--podium-3-text',
  '--shadow-xl',
  '--shadow-2xl',
  '--illustration-orange',
  '--illustration-tennis-ball',
]);

/** Whether a light value follows, through `var(--…)`, a token that dark mode redefines. */
function followsADarkValue(name: string, seen = new Set<string>()): boolean {
  if (darkTokens.has(name)) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const value = lightTokens.get(name) ?? '';
  return [...value.matchAll(/var\((--[\w-]+)\)/g)].some(([, reference]) => followsADarkValue(reference, seen));
}

describe('theme file', () => {
  it('defines every token it references, so no setting silently falls back to the inherited colour', () => {
    const undefinedTokens = [...referencedTokens].filter((name) => !definedTokens.has(name));

    expect(undefinedTokens).toEqual([]);
  });

  it('turns dark mode on from the device setting, with no class the app has to add', () => {
    expect(darkTokens.size).toBeGreaterThan(0);
    expect(themeCss).not.toMatch(/^\s*\.dark\s*\{/m);
  });

  it('gives every colour role a dark value, or one it follows, unless it is listed as the same in both modes', () => {
    const roles = [...lightTokens.keys()].filter((name) => !name.startsWith('--color-') && !NOT_A_COLOUR.test(name));
    const missing = roles.filter((name) => !SAME_IN_BOTH_MODES.has(name) && !followsADarkValue(name));

    expect(missing).toEqual([]);
  });

  it('lists as the same in both modes only roles that really have no dark value', () => {
    const listedButChanged = [...SAME_IN_BOTH_MODES].filter((name) => !lightTokens.has(name) || followsADarkValue(name));

    expect(listedButChanged).toEqual([]);
  });

  it('sets dark mode only on roles, never by changing a raw brand colour', () => {
    expect([...darkTokens.keys()].filter((name) => name.startsWith('--color-'))).toEqual([]);
  });

  it('puts dark mode on graphite pages and cards with the navy kept for the header bar', () => {
    expect(darkTokens.get('--surface-canvas')).toBe('var(--color-graphite-900)');
    expect(darkTokens.get('--surface-raised')).toBe('var(--color-graphite-800)');
    expect(lightTokens.get('--color-graphite-900')).toBe('#121316');
    expect(lightTokens.get('--color-graphite-800')).toBe('#1a1c20');
    expect(darkTokens.has('--surface-inverse')).toBe(false);
    expect(lightTokens.get('--surface-inverse')).toBe('var(--color-navy-600)');
  });

  it('uses today’s gold in light mode and the muted gold in dark mode', () => {
    expect(lightTokens.get('--accent-primary')).toBe('var(--color-gold-400)');
    expect(lightTokens.get('--color-gold-400')).toBe('#f5b800');
    expect(darkTokens.get('--accent-primary')).toBe('var(--color-gold-muted)');
    expect(lightTokens.get('--color-gold-muted')).toBe('#dcb455');
  });

  it('uses the dusty red in each mode, with dark text on a red button in dark mode', () => {
    expect(lightTokens.get('--color-red-400')).toBe('#b05157');
    expect(lightTokens.get('--color-red-300')).toBe('#c46a70');
    expect(lightTokens.get('--text-danger')).toBe('var(--color-red-400)');
    expect(darkTokens.get('--text-danger')).toBe('var(--color-red-300)');
    expect(darkTokens.get('--text-on-danger')).toBe('var(--color-graphite-900)');
  });

  it('draws the How to Play grass in the dusty greens in both modes', () => {
    expect(lightTokens.get('--illustration-grass')).toBe('#7d9c72');
    expect(lightTokens.get('--illustration-grass-dark')).toBe('#6c8a62');
    expect(darkTokens.get('--illustration-grass')).toBe('#55705a');
    expect(darkTokens.get('--illustration-grass-dark')).toBe('#4a634f');
  });

  it('draws the hockey puck with a dark value of its own, so it shows on graphite ice', () => {
    expect(darkTokens.get('--illustration-puck')).toBe('#0a0b0d');
    expect(darkTokens.get('--illustration-puck-top')).toBe('#5a5e66');
  });

  it('gives small labels the navy haze in dark mode, since label blue on graphite is too dark to read', () => {
    expect(darkTokens.get('--text-label')).toBe('var(--color-navy-200)');
  });

  it('sets leaderboard totals at 18px, a step above the 16px row text, without a colour of their own', () => {
    const scoreTotal = /\.score-total \{([^}]*)\}/.exec(themeCss)?.[1] ?? '';

    expect(scoreTotal).toMatch(/font-size: 1\.125rem;/);
    expect(scoreTotal).not.toMatch(/(^|[^-])color:/);
  });
});
