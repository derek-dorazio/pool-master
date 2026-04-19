# PoolMaster — Brand Exploration

Login-page branding proposals from **Pam** (product framing, copy) and **Fran**
(visual direction, mockups). Seven mockups across five distinct directions —
Playbook and Draft Night each have two color variants. Every mockup is a
standalone browsable HTML file plus a ready-to-paste AI image prompt for the
hero artwork.

These are design inputs, not implementation. Nothing in `brand/` is wired into
the webapp. After a direction is picked, Fran opens a plan slice against
`clients/poolmaster/src/features/auth/auth-home-page.tsx` and Pam finalizes the
copy.

---

## How to preview

Open any of the following in your browser:

- `brand/index.html` — gallery of all concepts
- `brand/concepts/01-season-ticket/index.html`
- `brand/concepts/02-playbook/index.html` — Dark
- `brand/concepts/02b-playbook-light/index.html` — Light
- `brand/concepts/03-sunday-prime/index.html`
- `brand/concepts/04-back-table/index.html`
- `brand/concepts/05-draft-night/index.html` — Neon (cyan + lime)
- `brand/concepts/06-draft-night-ice/index.html` — Ice (monochromatic blue)

Each mockup renders with a CSS-generated hero background so it reads today. To
swap in a real hero image: drop a file at
`brand/concepts/<slug>/hero.jpg` — the mockup picks it up automatically.

---

## Pam — placeholder copy audit

The current `auth-home-page.tsx` carries placeholder and internal-doc copy that
reads like onboarding notes rather than a landing surface. Recommendations apply
to every concept:

| Where | Current | Problem | Fix |
|---|---|---|---|
| H2 headline | "Run your league, manage your team, and keep every pool night organized." | Three verbs, generic, no brand voice | Replace with a 4–7 word tagline (per concept) |
| Subhead | "PoolMaster gives commissioners one place to create leagues, invite members, manage teams, and grow into contests as new features come online." | Feature list + roadmap leak | One value sentence, no roadmap language |
| Two info cards | "Commissioners start by..." / "Members join later..." | UX explanation, not marketing | Remove. If a secondary beat is needed, use social proof or one crisp feature callout |
| Form placeholders | `"Taylor"`, `"Commissioner"`, `"yourname"`, `"Enter your password"`, `"Re-enter your password"` | Filler-name placeholders add noise; label already says what the field is | Drop filler-name placeholders. Keep functional examples only for ambiguous fields (identifier, email) |
| Footer explainer | "Registration signs you in and lands you on your normal app home. If you have no leagues yet, that landing page becomes your first-time commissioner welcome state." | Internal documentation text | Delete. Keep only the mode-switch link |
| Eyebrow pill | "POOLMASTER" | Redundant with the wordmark shown next to it | Replace with a contextual eyebrow per concept, or remove |

All five mockups apply this cleanup.

---

## The concepts

| # | Name | Tagline | Palette | Vibe |
|---|---|---|---|---|
| 01 | Season Ticket | *Where your league lives.* | Forest + cream + vintage gold | Timeless almanac, heritage, "we've run this pool since 2003" |
| 02 | Playbook — Dark | *Run the league. Skip the spreadsheet.* | Near-black + electric lime + graphite | SaaS-sharp, Linear/Notion, tool-first |
| 02b | Playbook — Light | *Run the league. Skip the spreadsheet.* | Warm off-white + ink black + chartreuse-lime | Swiss-editorial, paper-and-ink, lime-as-highlighter-block |
| 03 | Sunday Prime | *Every pick. Every week. One place.* | Stadium navy + victory gold + red | Broadcast gameday, high-energy |
| 04 | Back Table | *Your league, your rules, your people.* | Terracotta + deep teal + paper | Indie, warm, group-chat-with-scoring |
| 05 | Draft Night — Neon | *Draft day, every day.* | Midnight + cyan + lime | Late-night arcade-sports, draft-party energy |
| 06 | Draft Night — Ice | *Draft day, every day.* | Midnight + cyan + royal blue + frost | Cold, pro, "Blade Runner meets ESPN stats overlay" |

Open the mockups side-by-side — the differences are typography, color, logo
mark, hero treatment, and voice. Form structure is identical so you're judging
brand, not UX mechanics.

---

## How to swap in a real hero image

Each concept has a `prompt.md` with a ready-to-paste prompt for
Midjourney / DALL-E 3 / Gemini / Nano Banana. Workflow:

1. Copy the prompt out of `brand/concepts/<slug>/prompt.md`
2. Generate at the aspect ratio the prompt suggests (portrait 4:5 or 3:4)
3. Save as `brand/concepts/<slug>/hero.jpg`
4. Reload the mockup — the hero slot picks it up automatically

Nothing else to wire. If the image is missing the CSS gradient stands in.

---

## What happens after you pick one

Pam → refines copy and confirms the headline/subhead against invite-context
branches (the auth page also renders invite-scoped copy for league and
team-owner invites, which this exploration doesn't touch yet).

Fran → opens a webapp slice against
`clients/poolmaster/src/features/auth/auth-home-page.tsx`, adds brand tokens to
the Tailwind theme, extracts the logo to an `/assets` SVG, and ships the hero.

Before implementation, run the design through the product-design workflow in
`rules/workflow-rules.md` §Product Design Workflow (use-case doc + review) if
the direction changes more than the login surface — e.g. app-wide logo, nav,
or palette.
