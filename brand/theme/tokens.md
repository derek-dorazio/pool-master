# Ultimate Pool Manager — Design Tokens

Authoritative token spec for the Sunday Prime direction. `tokens.css` is the
drop-in CSS custom-property file; this doc is for humans and for mapping into
Tailwind config when Fran wires it up.

---

## Color

### Brand scales

| Role | Hex | Use |
|---|---|---|
| `navy-600` | `#0b1e3f` | **Primary brand.** App chrome, hero surfaces, buttons on paper. |
| `navy-500` | `#16325e` | Elevated navy surface (cards-on-navy, nav active states). |
| `navy-800` | `#05122a` | Deep navy — full-bleed backdrops, outer page. |
| `gold-400` | `#f5b800` | **Primary accent.** CTAs on navy, emphasis, scoreboard numbers. |
| `gold-300` | `#ffc82e` | Hover state for gold CTAs. |
| `red-400`  | `#a8202d` | Live indicators, destructive actions, errors. |
| `paper`    | `#f5f5f2` | Default app canvas. |
| `ink`      | `#0b0b0b` | Primary text on paper. |

Full 50–900 scales live in `tokens.css`.

### Semantic aliases

Use semantic tokens in code — raw scales only when defining new components.

```
surface-canvas          → paper (app background)
surface-raised          → white (cards, modals)
surface-inverse         → navy-600 (header, hero, dark sections)
surface-inverse-deep    → navy-800 (outer page, footer)

text-primary            → navy-600
text-secondary          → neutral-600
text-muted              → neutral-500
text-on-inverse         → white
text-on-inverse-muted   → rgba(white, 0.66)
text-accent             → gold-400
text-danger             → red-400

border-subtle           → rgba(navy, 0.10)
border-default          → rgba(navy, 0.18)
border-strong           → navy-600
border-on-inverse       → rgba(white, 0.12)

accent-primary          → gold-400
accent-primary-hover    → gold-300
focus-ring              → 0 0 0 3px rgba(gold, 0.45)
```

---

## Typography

**Display** — `Archivo` (600, 700, 900; italic at 800/900)
**Body** — `Inter` (400, 500, 600, 700)
**Mono** — system monospace

### Type scale

| Token | Size | Typical use |
|---|---|---|
| `text-xs` | 12 | Fine print, table meta |
| `text-sm` | 13 | Label, helper text |
| `text-base` | 14 | Body default |
| `text-md` | 16 | Emphasized body, subhead |
| `text-lg` | 18 | Section lede |
| `text-xl` | 22 | Card title |
| `text-2xl` | 28 | Page title |
| `text-3xl` | 36 | Landing subhead |
| `text-4xl` | 44 | Section hero |
| `text-5xl` | 56 | Page hero (body-text pages) |
| `text-6xl` | 72 | Login hero (display) |

### Treatments

- **Display headline** — `font-display`, italic, 900, `tracking-display`, uppercase, `leading-tight`.
- **Eyebrow** — `font-display`, 700, `text-xs`, `tracking-eyebrow`, uppercase.
- **Label** — `font-display`, 700, `text-xs`, `tracking-label`, uppercase.
- **Body** — `font-body`, 400, `text-base`, `leading-normal`.

---

## Spacing

Standard 4-px scale (matches Tailwind default):
`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`.

No bespoke spacing tokens — keep this aligned with Tailwind.

---

## Radii

| Token | px | Use |
|---|---|---|
| `radius-sm` | 4 | Tight controls (tag pill inner, checkbox) |
| `radius-md` | 6 | Tab inner, small inputs |
| `radius-lg` | 8 | Inputs, buttons, cards-small |
| `radius-xl` | 12 | Primary card, scoreboard |
| `radius-2xl` | 16 | Hero/modal |
| `radius-3xl` | 24 | Landing shell |
| `radius-pill` | 9999 | Badges, chips, avatars |

---

## Shadow

| Token | Use |
|---|---|
| `shadow-sm` | Resting card, subtle lift |
| `shadow-md` | Hover, popover |
| `shadow-lg` | Modal, dropdown |
| `shadow-xl` | Landing hero shell |
| `shadow-focus` | Input/button focus |
| `shadow-gold-glow` | Gold accent emphasis (live tag) |
| `shadow-red-pulse` | Live dot pulse ring |

---

## Motion

- `duration-fast` 120ms — hover, focus
- `duration-base` 200ms — general transitions
- `duration-slow` 320ms — entrance/exit

Default easing: `ease-out`. Use `ease-in-out` for loops/reversals only.

---

## Tailwind mapping (preview)

When Fran wires the theme, extend `tailwind.config.ts` along these lines. Exact
shape depends on the current config — treat this as a sketch, not a drop-in.

```ts
theme: {
  extend: {
    colors: {
      navy:  { 50: '#eaeef6', 100: '#c9d3e6', /* … */ 600: '#0b1e3f', /* … */ },
      gold:  { 300: '#ffc82e', 400: '#f5b800', /* … */ },
      red:   { 400: '#e11d2b', /* … */ },
      paper: '#f5f5f2',
      ink:   '#0b0b0b',
    },
    fontFamily: {
      display: ['Archivo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      body:    ['Inter',   'ui-sans-serif', 'system-ui', 'sans-serif'],
    },
    fontSize: {
      // match scale above; default already ships xs–6xl close to these
    },
    borderRadius: {
      '3xl': '24px',
    },
    boxShadow: {
      focus:     '0 0 0 3px rgba(245, 184, 0, 0.45)',
      'gold-glow': '0 0 0 3px rgba(245, 184, 0, 0.3)',
      hero:      '0 40px 80px -30px rgba(0, 0, 0, 0.7)',
    },
  },
}
```

Semantic aliases should land as Tailwind plugin utilities or as CSS vars in a
`globals.css` layer so Tailwind arbitrary values can reference them
(`bg-[var(--surface-inverse)]`).
