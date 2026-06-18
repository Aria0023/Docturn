# DocTurn — Marketing Landing UI Kit (DoctorHeidi aesthetic)

A high-fidelity recreation of the DocTurn public marketing surface — the warm, expressive
"DoctorHeidi" side of the brand. Open **`index.html`**.

> Built from the style guide's marketing direction (`client/src/pages/doctorheidi-landing.tsx`
> per the spec). The real codebase mount was empty, so this is a faithful interpretation.

## What it shows
Sticky glassy **nav** → **hero** on the signature sky→white→rose gradient with a floating
product preview → customer **logos** → **features** grid → **how it works** → **security &
compliance** → **pricing** → gradient **final CTA** → dark **footer**.

## Files
| File | What it is |
|---|---|
| `index.html` | Page composition + responsive CSS. |
| `sections-hero.jsx` | `Nav`, `Hero`, `HeroPreview`, `CTA`, `MIcon`. |
| `sections-body.jsx` | `Logos`, `Features`, `HowItWorks`, `Security`, `Pricing`, `FinalCTA`, `Footer`. |
| `tokens.css` | Copy of the root design tokens. |
| `assets/` | Marketing wordmark + sky glyph tile. |

## Brand notes honored
- **Marketing personality:** sky→white→rose gradients, `rounded-2xl` cards, `shadow-xl`,
  large display headings (`text-5xl/6xl`, leading-tight), gentle **float** + **glow** motion
  (gated behind `prefers-reduced-motion`).
- Sky-gradient CTAs carry the brand `shadow-glow`. Gradients stay on marketing — never the product.
- Voice: action-oriented, "Get started free" (not "Submit"); calm and confident.
- Lucide icons via CDN. No PHI in any imagery (synthetic initials only).
