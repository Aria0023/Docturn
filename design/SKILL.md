---
name: docturn-design
description: Use this skill to generate well-branded interfaces and assets for DocTurn (the HIPAA-oriented hospital patient-assignment & secure-messaging platform, marketed as DoctorHeidi), either for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# DocTurn design skill

Read **`README.md`** in this skill first — it covers the product context, content
fundamentals (voice & tone), visual foundations, iconography, and a full index of files.
Then explore the other available files:

- **`colors_and_type.css`** — all design tokens (color, type, spacing, radius, elevation) as
  CSS variables. Import this and reference semantic tokens, never raw hex.
- **`assets/`** — brand marks (wordmark + glyph, product + marketing variants).
- **`preview/`** — small specimen cards (color, type, spacing, components, brand).
- **`ui_kits/web-app/`**, **`ui_kits/marketing/`**, **`ui_kits/mobile/`** — high-fidelity,
  interactive recreations of the three product surfaces, with reusable JSX components.

## How to use it
- **Visual artifacts** (slides, mocks, throwaway prototypes): copy the assets and tokens you
  need out of this skill and produce static/standalone HTML files for the user to view. Pull
  components from the relevant UI kit rather than rebuilding them.
- **Production code**: copy assets and read the rules here to design faithfully with the brand
  (the real product is React + Vite + Tailwind + shadcn/ui; Lucide for icons).

## Non-negotiable brand rules
1. **Light mode only** — no dark variants.
2. **Red = destructive/critical, amber = pending** — the status color language is fixed.
3. **Lead with neutrals**; one primary action per view; color marks only what needs attention.
4. **Pair every status color with an icon and/or label**; preserve the 2px focus outline.
5. **Product = calm + compact; marketing = expressive + generous** (sky/rose gradients,
   glow/float motion). Gradients belong to marketing only.
6. **PHI safety** — patients are referenced by initials only; never invent realistic full
   names or place PHI in imagery.

If the user invokes this skill without other guidance, ask what they want to build or design,
ask a few focused questions, then act as an expert DocTurn designer who outputs HTML artifacts
**or** production code, depending on the need.
