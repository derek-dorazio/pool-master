# Theme Adoption — Overview

This is a **seed for planning**, not a plan. Sunday Prime is the elected brand
direction; this doc sketches what it takes to move the theme from
`brand/theme/` into the live app. A real plan goes through the Product Design
Workflow in `rules/workflow-rules.md` before any code lands.

---

## What exists today

- `brand/theme/tokens.css` — CSS custom properties for color, type, radius, shadow, motion.
- `brand/theme/tokens.md` — human-readable spec + Tailwind mapping sketch.
- `brand/theme/index.html` — static sample showing tokens applied to common UI primitives on both paper and navy surfaces.

Nothing here is wired into the webapp. No app code has changed.

---

## What adoption means

Three layers, rolled out in order. Each is its own plan slice.

### 1. Token layer (foundation)
- Extend `clients/poolmaster/tailwind.config.*` with the brand scales (`navy`, `gold`, `red`), font families, and radius/shadow extensions from `tokens.md`.
- Load `Archivo` + `Inter` via the existing font loader (confirm present; fall back to `@import` in `globals.css` otherwise).
- Drop `tokens.css` (or equivalent) into the global layer for semantic aliases consumable as `bg-[var(--surface-inverse)]`.
- Verify: no visual change yet — only new tokens available.

### 2. Chrome layer (high-visibility surfaces)
- Login / auth-home (`clients/poolmaster/src/features/auth/auth-home-page.tsx`) — the surface these concepts were designed against. This is the acceptance test for the theme.
- App header / top nav — apply navy chrome, gold accent, display font.
- Primary buttons, inputs, badges — migrate the shared primitives once so the rest of the app inherits.
- Empty states and loading skeletons — low-traffic but high-trust surfaces.

### 3. Feature surface sweep
- Leagues, contests, teams, standings — feature pages that already exist. Each gets a light pass to replace ad-hoc colors with tokens and display-font headings where appropriate.
- Tables and scoreboards — pattern-match against the sample table in `index.html`.
- Out-of-scope for now: marketing site, email templates, mobile splash.

---

## Risks / things to resolve before a plan

- **Dark-on-light vs dark-on-dark.** Today the app is mostly paper. Sunday Prime's identity leans on navy chrome + gold accents — we need to pick where navy shows up (full nav? hero only? per-route?). The sample demos both; the answer affects component API.
- **Existing Tailwind primitives.** If there's a shared `Button` / `Input` / `Card` set already, migrate those first and the rest falls in. If components are ad-hoc per feature, token rollout is noisier.
- **Invite-scoped auth branches.** `auth-home-page.tsx` renders different copy for league/team-owner invites. Pam needs to finalize copy across variants before Fran ships.
- **Font loading.** Archivo 900 italic is a specific weight — confirm it's loaded and not falling back to synthetic italic.
- **Scope decision** (see brand rename note below).

---

## Open scope question — product rename

Sunday Prime mockup renamed "PoolMaster" → "Ultimate Pool Manager". Still
Sunday-Prime-local. Before adoption:

- Decide if this is the canonical product name.
- If yes: separate rename plan (package names, README, generated OpenAPI titles, UI copy) — unrelated to the theme but blocks the login surface.

---

## Next step

Open a plan slice for **layer 1 (tokens)** against `clients/poolmaster/tailwind.config.*` + `globals.css`. Keep it no-visual-change; that's the safest landing. Layers 2 and 3 get their own slices after.
