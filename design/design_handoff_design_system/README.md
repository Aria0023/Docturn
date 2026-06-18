# Handoff: DocTurn Design System (whole system)

## Overview
This package hands off the **complete DocTurn design system** — brand, visual foundations
(color, type, spacing, radius, elevation, motion), content/voice rules, and three
high‑fidelity **UI kits** (clinical web app, DoctorHeidi marketing landing, and mobile app).
DocTurn is a multi‑tenant, HIPAA‑oriented platform that coordinates the **ER → hospitalist
patient hand‑off** and provides secure clinical messaging. It is marketed publicly as
**DoctorHeidi**.

The goal of this handoff is to let a developer (using Claude Code) implement DocTurn
interfaces in a real codebase that look and behave exactly like these references.

## About the design files
The files in this bundle are **design references created in HTML/JSX** — prototypes that
show the intended look, structure, and behavior. They are **not production code to copy
directly**. Your task is to **recreate these designs in the target codebase's existing
environment** using its established patterns and libraries. If no codebase exists yet,
choose the framework the spec already implies (see *Tech stack* below) and implement there.

The single source of truth for visual values is **`colors_and_type.css`** — every color,
type step, spacing unit, radius, and shadow is a CSS variable there. Reference the
**semantic token**, never a raw hex.

## Fidelity
**High‑fidelity (hifi).** Final colors, typography, spacing, radius, shadows, motion, and
interaction states are all specified and present in the token CSS and the UI kits. Recreate
the UI pixel‑accurately using the codebase's existing libraries (Tailwind + shadcn/ui in
the named stack), mapping each visual to the matching semantic token.

## Tech stack (from the engineering spec — target for reuse)
- **Backend** — Node 20 / Express (TypeScript, ESM), Drizzle ORM, PostgreSQL, Passport (local), `ws` WebSockets, Zod.
- **Web** — React 18 + Vite, wouter routing, TanStack Query v5, **Tailwind CSS + shadcn/ui**, `@dnd-kit`.
- **Mobile** — Expo SDK 52 / React Native 0.76, `@react-navigation` bottom‑tabs.
- **Integrations** (server‑side) — Twilio (SMS + MFA), OpenAI (intake extraction + commands), Firebase (push), Amion (scheduling).

> Implement the visuals with the codebase's shadcn/ui components and the Tailwind token map.
> Tokens in `colors_and_type.css` correspond to the `client/src/index.css` +
> `tailwind.config.ts` variables named in the spec.

---

## One system, two personalities
The **same** tokens, type scale, and components power every surface — only the **density**
and **amount of decoration** change. Gradients and animated accents belong to marketing;
the product stays calm and neutral.

| Surface | Feel | Reference kit |
|---|---|---|
| **Clinical web app** | Efficient, legible, low‑noise. White backgrounds, compact spacing, semantic status color, `rounded-md` controls. | `ui_kits/web-app/` |
| **DoctorHeidi marketing** | Warm, inviting, aspirational. Sky→white→rose gradients, large display headings, glow/float motion, `rounded-2xl` cards. | `ui_kits/marketing/` |
| **Mobile app** | Focused, touch‑first. Same tokens, larger touch targets, portrait‑first, bottom‑tab nav. | `ui_kits/mobile/` |

### User roles (drive what each screen shows)
| Role | Responsibility |
|---|---|
| **director** | Hospital admin: providers, shift definitions, round‑robin config, reassignment, org settings. |
| **er_director** | ER admin: ER physicians, ER‑side flow oversight. |
| **er_doctor / er_physician** | Admits patients, creates assignment requests, AI‑assisted intake. |
| **hospitalist** | Receives assignments, accepts/declines, manages census + patient cap, messages peers. |
| **developer** | Platform operator: cross‑tenant admin, CMS, integrations, diagnostics, impersonation. |

---

## Design tokens (authoritative file: `colors_and_type.css`)

### Color
- **Primary action = blue** — `hsl(221 83% 53%)` / `#2563EB`. Primary buttons, links, active
  state, focus ring, brand mark, marketing CTA.
- **Marketing "sky" family** — Sky 400 `#38BDF8` → Sky 500 `#0EA5E9` → Sky 700 `#0369A1`,
  plus a warm **rose** tail, for gradients and soft accents.
- **Lead with neutrals.** Most of any product screen is white + foreground text; color marks
  only what needs attention. **One primary action per view.**
- **Status language is fixed** (always paired with icon/label, never color alone):
  **amber** = pending/expiring · **emerald** = accepted/online · **blue** = active/sent ·
  **red** = rejected/critical/destructive · **slate** = offline/expired/disabled.
- A **healthcare palette** (`.bg-medical-*`, `.text-medical-*`) covers clinical semantics
  beyond base UI tokens.
- **Light mode only** — `color-scheme: light`, no dark theme, no `dark:` variants. All tokens
  are HSL CSS variables; reference the semantic token, never a raw hex.

### Type
- **No custom web font.** Native system sans stack (`ui-sans-serif, system-ui, -apple-system,
  "Segoe UI", Roboto, …`); mono stack for code/IDs. Body is `font-sans antialiased`.
- **Scale** = Tailwind steps. Product stays **sm–2xl (14–24px)** for density; **display
  4xl–6xl (36–60px)** is reserved for marketing heros.
- **Weights:** 700 bold (headings, hero, card titles, numeric stats) · 600 semibold (badges,
  sub‑labels) · 500 medium (buttons — shadcn default) · 400 normal (body).
- In practice: page heading = `text-2xl font-bold`; section = `text-lg font-bold`; marketing
  hero = `text-5xl md:text-6xl font-bold leading-tight`; muted body = `text-sm text-muted-foreground`.

### Spacing & layout
- **4px base scale** (4·6·8·12·16·20·24·32·48·64). Card padding 16–24px; section padding 32px;
  landing vertical rhythm 48–64px. Product compact; marketing generous. No arbitrary values.

### Radius
- Base `--radius: 0.5rem` (8px) with steps: **sm 4 · md 6** (buttons, inputs) · **lg 8**
  (cards, popovers, dialogs) · **xl 12 / 2xl 16** (marketing cards, hero panels) ·
  **full 9999** (badges, avatars, status dots, pills).

### Elevation / shadows
- Soft shadows that lift, not decorate. `sm` resting buttons/small cards; `md/lg` primary CTAs
  and raised panels; `xl/2xl` marketing hero cards, modals, hover‑lifted cards. Depth
  increases on hover for clickable cards. Signature **brand glow** (`shadow-sky-500/30`) on the
  landing CTA, paired with `pulse-glow`.

### Backgrounds
- **Product:** flat white surfaces — no textures, patterns, or decorative gradients.
- **Marketing:** signature **sky→white→rose** gradient (`#E0F2FE → #FFFFFF → #FFE4E6`), soft
  gradient panels, clean product mockups over light/airy stock. **Never put PHI in imagery.**

### Cards
- **Product:** white surface, `rounded-lg`, 1px border (`--border`), soft `shadow-sm`, 16–24px
  padding. Title (bold) + content + at most **one** primary action.
- **Marketing:** `rounded-2xl`, gradient/tinted backgrounds, `shadow-xl`, hover‑lift.

### Borders
- 1px, `hsl(214 32% 91%)` for dividers, control borders, input outlines. Borders + soft shadow
  define product surfaces — not heavy outlines.

---

## Motion & interaction
- **Purposeful, brief, honors `prefers-reduced-motion`.** Product motion = feedback, loading,
  subtle state transitions only; marketing gets the expressive set.
- Named animations: `fade-in-up` (0.6s ease‑out, staggered `.delay-100…600`), `bounce-in`,
  `hover-lift` (0.3s), `pulse-glow` (2s ∞, primary CTA), `float` (6s ∞, marketing accents),
  `animate-gradient` (8s ∞), `shimmer` (1.5s ∞, skeletons), `status-pulse` (1.5s ∞, presence
  dots), `wiggle` (icon hover), accordion (0.2s). Gentle ease‑out, no harsh bounces in product.
  Default transitions ≈150–300ms.
- **Hover:** secondary/ghost buttons get a light `--secondary` fill; cards lift with deeper
  shadow; links underline. **Active:** primary stays solid, subtle darken. **Focus:** global
  `:focus-visible` draws a **2px primary outline, 2px offset** on every focusable element —
  never remove it.
- Transparency/blur used sparingly; marketing only. No glassmorphism in dense clinical screens.

---

## Iconography
- **UI icons: `lucide-react`** — single consistent line/stroke set, canonical across the
  product. (These references load Lucide from CDN — same glyph set.)
- **Brand/company logos: `react-icons/si`** (Simple Icons) for third‑party marks.
- **Size:** 16px (`size-4`) inside buttons; icons non‑interactive, shrink‑protected.
- **Color:** inherit `currentColor` — icons follow text/status color.
- **Meaning:** icons **reinforce**, never the sole carrier; every status color is paired with
  an icon and/or label. No emoji/unicode as icons in product UI.
- **Brand mark:** wordmark + a rounded‑square **"D"** glyph. PWA icon = white "D" on solid
  `#2563EB`, 45px corner radius (maskable). On landing, the glyph sits in a sky‑gradient tile.
  Clear space = the height of the "D" on all sides. Don't recolor the glyph, stretch the
  wordmark, or place it on a busy photo without solid/gradient backing.

---

## Content fundamentals (voice & tone)
DocTurn "talks like a calm, competent colleague." Copy is read by busy clinicians under
pressure: **clear, brief, jargon‑free.**
- **Clear over clever** — buttons name the action ("Send assignment", not "Submit").
- **Brief** — short labels; clinicians scan.
- **Calm & respectful** — no alarmist language; urgency carried by color + status, never "!".
- **Action‑oriented** — buttons start with a verb (Accept, Decline, Reassign, Message, Send).
- **Privacy‑aware** — never expose more PHI than necessary; patients referenced by **initials
  only** (e.g. "SC"), never full names.
- **Casing:** sentence case everywhere (not Title Case, not ALL CAPS except tiny overlines).
- **Emoji:** none in product UI.

| Context | Prefer | Avoid |
|---|---|---|
| Primary CTA (marketing) | **Get started free** | Submit |
| Assignment sent | **Assignment sent to Dr. Chen** | Operation successful |
| Error | **Couldn't send — try again** | Error 500 |
| Empty state | **No pending assignments** | Nothing here |
| Destructive confirm | **Delete this conversation?** | Are you sure? |

---

## What's in this bundle
| Path | Contents |
|---|---|
| `README.md` | This handoff (self‑sufficient). |
| `DESIGN_SYSTEM_REFERENCE.md` | The full system doc with every foundation in detail. |
| `Mock-vs-Live-Gap-Analysis.html` | **Dev-facing diff** — reconciles the design mock against the running Replit build + Requirements/Data-Model spec v1.0. Screen-by-screen status (Match / Partial / Missing / Mock-only / Data-model), the schema changes the mock's improvements depend on, and a prioritized action list. Open in a browser or print to PDF. **Start here for what to build vs. what the mock already solves.** |
| `colors_and_type.css` | **Authoritative tokens** — color (incl. healthcare + status), type scale, spacing, radius, elevation, plus semantic helper classes. Map these to the codebase's token layer. |
| `assets/` | Brand marks: `docturn-glyph.svg` (blue PWA glyph), `docturn-glyph-sky.svg` (landing tile), `docturn-wordmark.svg`, `docturn-wordmark-marketing.svg`. |
| `kits/web-app.html` | Clinical web app kit — ER doctor + hospitalist + director + developer dashboards, login, messaging, patient board, settings. Self‑contained interactive click‑through; open in any browser. |
| `kits/marketing.html` | DoctorHeidi landing kit — hero, features, pricing, nav/footer. Self‑contained. |
| `kits/mobile.html` | Mobile app kit — phone‑framed screens with bottom‑tab nav. Self‑contained. |
| `kits/assets/` | Brand SVGs referenced by the kit HTML (keep alongside the `kits/*.html` files). |

> The `kits/*.html` files are bundled, offline‑ready references — open them in a browser to
> see the intended UI and interactions. Treat them as visual/structural references to
> reimplement with the codebase's components, not as code to ship.

> **Asset note:** the original codebase mount came through empty, so the brand marks in
> `assets/` were rendered as SVG faithfully to the style guide's exact description, and the
> UI kits are faithful interpretations of the two source specs (not byte‑for‑byte component
> copies). If you have the repo, tighten against `client/src/pages/*`,
> `client/src/components/ui/*`, and `mobile-app/`, and swap in the real `manifest.json` icons.

## How to view the references
1. Open each `kits/*.html` file directly in a browser to see the intended UI and
   interactions — they are self‑contained and work offline (keep `kits/assets/` beside them).
2. Read them for structure, copy, status‑color usage, and spacing, then reimplement with the
   target codebase's components.

## Implementation rules (non‑negotiable)
1. `@import` / map **`colors_and_type.css`** and reference **semantic tokens**, not raw hex.
2. **Red = destructive/critical, amber = pending** — everywhere, no exceptions.
3. **Light mode only.** No `dark:` variants.
4. **One primary action per view.** Lead with neutrals; color marks attention.
5. **Pair color with icon/label.** Preserve the focus outline.
6. Product = compact + calm; marketing = generous + expressive. Same tokens, different density.
