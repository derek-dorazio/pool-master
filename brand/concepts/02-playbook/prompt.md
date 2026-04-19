# Hero Image Prompt — 02 Playbook

**Save output as:** `brand/concepts/02-playbook/hero.jpg`
**Aspect ratio:** 4:5 portrait (e.g. 1200×1500 or 1024×1280)
**Target mood:** modern, bold, SaaS-sharp — *"Linear/Notion for commissioners"*

---

## Prompt (paste into Midjourney / DALL-E 3 / Gemini / Nano Banana)

> A minimalist editorial 3D render in a pitch-black void. Floating abstract geometric shapes representing a tournament bracket: clean rectangular cards, thin connecting lines, and a single bright chartreuse-lime accent line cutting diagonally across the composition. The cards are matte charcoal with soft rim-lighting; one card glows with the lime accent. Subtle dust particles in the air catch the light. Inspired by Linear app, Framer brand art, and modernist architectural renders. High contrast, crisp edges, generous negative space. Dramatic rim-light from the right. No text, no logos, no people. Palette: near-black (#0a0a0a), electric chartreuse-lime (#c8ff3d), graphite grey, white highlights only.

**Midjourney tail:** ` --ar 4:5 --style raw --stylize 250`
**DALL-E 3 note:** request "portrait orientation, modern 3D render style."

---

## Negative prompt / avoid

- No skeuomorphic textures (no paper, leather, wood, fabric)
- No warm tones — keep it cool and high-contrast
- No text, numbers, or readable labels
- No recognizable sports iconography (stadiums, balls, jerseys)
- No ray-traced glossy reflections that muddy the composition
- Avoid generic "AI tech" clichés — circuit boards, robots, HUDs

## Alt direction — typographic

> A single oversized chartreuse-lime forward-slash "/" punctuation mark, rendered as brushed aluminum with glowing edges, floating against pure black. Soft studio light, architectural scale, film grain. Minimal, bold, editorial.

## How the hero slot uses this

The left ~620px-wide pane carries the image edge-to-edge. Headline renders in white with a lime accent word. Hero overlay is applied in CSS — keep the **upper-left quadrant** the lightest visual weight so the headline pops.
