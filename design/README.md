# DocTurn Design System

> Brand, visual foundations, and UI kits for **DocTurn** — a multi‑tenant, HIPAA‑oriented
> platform that coordinates **patient assignment** and **secure clinical messaging** inside
> hospitals. (Marketed publicly as **DoctorHeidi**.)

This folder is a working design system: brand foundations, color + type tokens, real
visual assets, and high‑fidelity UI kit recreations of the product. Use it to generate
well‑branded DocTurn interfaces and assets — for production or throwaway mocks.

---

## 1. Company & product context

DocTurn coordinates the **ER → hospitalist hand‑off**. Emergency‑room physicians admit
patients and create assignment requests; the platform routes each patient to the next
eligible hospitalist via a configurable **round‑robin rotation**, notifies them in real
time across multiple channels (WebSocket → push → SMS), tracks acknowledgement, and
provides a HIPAA‑compliant **messaging** layer for all providers.

It is **multi‑tenant**: every hospital is an independent `organization`, and all data is
isolated by `organizationId` at the data‑access layer.

### Primary user roles
| Role | Responsibility |
|---|---|
| **director** | Hospital admin: manages providers, shift definitions, round‑robin config, reassignment, org settings. |
| **er_director** | ER admin: manages ER physicians, oversees ER‑side flow. |
| **er_doctor / er_physician** | Admits patients, creates assignment requests, uses AI‑assisted intake. |
| **hospitalist** | Receives assignments, accepts/declines, manages census + patient cap, messages peers. |
| **developer** | Platform operator: cross‑tenant admin, CMS, integrations, diagnostics, impersonation. |

### The three surfaces (and the UI kits that recreate them)
| Surface | Feel | UI kit |
|---|---|---|
| **Clinical web app** | Efficient, legible, low‑noise. White backgrounds, compact spacing, semantic status color, `rounded-md` controls. | `ui_kits/web-app/` |
| **DoctorHeidi marketing landing** | Warm, inviting, aspirational. Sky→white→rose gradients, large display headings, glow/float motion, `rounded-2xl` cards. | `ui_kits/marketing/` |
| **Mobile app** | Focused, touch‑first. Same tokens, larger touch targets, portrait‑first, bottom‑tab nav. | `ui_kits/mobile/` |

**One system, two personalities:** the same tokens, type scale, and components power
every surface — only the **density** and **amount of decoration** change. Gradients and
animated accents belong to marketing; the product stays calm and neutral.

### Tech stack (for reference, from the engineering spec)
- **Backend** — Node 20 / Express (TypeScript, ESM), Drizzle ORM, PostgreSQL, Passport (local), `ws` WebSockets, Zod.
- **Web** — React 18 + Vite, wouter routing, TanStack Query v5, **Tailwind CSS + shadcn/ui**, `@dnd-kit`.
- **Mobile** — Expo SDK 52 / React Native 0.76, `@react-navigation` bottom‑tabs.
- **Integrations** (all server‑side) — Twilio (SMS + MFA), OpenAI (`gpt-4o` intake extraction, `gpt-4o-mini` commands), Firebase (push), Amion (scheduling).

---

## 2. Sources

Everything here is derived from two documents provided by the user, both dated 2026‑06‑05
and explicitly grounded in the live codebase:

- **`uploads/docturnstyle.pdf`** — *DocTurn Brand & Design Style Guide v1.0.* Source of
  truth for color, type, spacing, components, motion, voice, a11y. Cites
  `client/src/index.css`, `tailwind.config.ts`, `shadcn/ui`, `manifest.json`.
- **`uploads/docturn.pdf`** — *DocTurn Engineering Specification v1.0.* Architecture, data
  model (37 tables), REST + WebSocket API surface, auth, multi‑tenancy, the assignment
  workflow, integrations, and the web/mobile frontends.

**Codebase:** A `DocTurn/` repository was attached but the mount came through **empty**
(no files readable). The UI kits here are therefore **faithful interpretations built from
the two specs**, not byte‑for‑byte recreations of the React components. If you can
re‑attach the codebase via the Import menu, the kits can be tightened to the exact markup
(`client/src/pages/*`, `client/src/components/ui/*`, `mobile-app/`).

> Key code locations named in the spec (for whoever has the repo): color tokens & animations
> in `client/src/index.css`; token→Tailwind map in `tailwind.config.ts`; component variants
> in `client/src/components/ui/*`; marketing aesthetic in
> `client/src/pages/doctorheidi-landing.tsx`; brand/PWA identity in `manifest.json`.

---

## 3. Content fundamentals (voice & tone)

DocTurn "talks like a calm, competent colleague." Copy is read by busy clinicians under
pressure, so it is **clear, brief, and jargon‑free**.

- **Clear over clever.** Say exactly what an action does. Buttons name the action:
  *"Send assignment"*, not *"Submit"*.
- **Brief.** Short labels and sentences — clinicians scan, they don't read.
- **Calm & respectful.** No alarmist language; urgency is carried by **color + status**,
  never by exclamation marks.
- **Action‑oriented.** Buttons start with a verb: **Accept, Decline, Reassign, Message, Send**.
- **Privacy‑aware.** Never expose more PHI than necessary in copy, tooltips, or examples.
  Patients are referenced by **initials only** (e.g. "SC"), never full names.

**Casing:** Sentence case for everything — buttons, labels, headings, menu items.
Not Title Case, not ALL CAPS (except tiny overline/eyebrow labels if needed).
**Person:** Address the user directly where natural ("you"); the system is invisible.
**Emoji:** none in the product UI. **Punctuation:** minimal; an em‑dash for fallbacks
("Couldn't send — try again"), question marks only in destructive confirms.

### Microcopy examples (prefer → avoid)
| Context | Prefer | Avoid |
|---|---|---|
| Primary CTA (marketing) | **Get started free** | Submit |
| Assignment sent | **Assignment sent to Dr. Chen** | Operation successful |
| Error | **Couldn't send — try again** | Error 500 |
| Empty state | **No pending assignments** | Nothing here |
| Destructive confirm | **Delete this conversation?** | Are you sure? |

The **vibe**: trustworthy clinical software that gets out of the way. Reassuring and human
on marketing; fast, dense, and unambiguous in the product where seconds matter.

---

## 4. Visual foundations

### Color
- **Primary action color is blue** — `hsl(221 83% 53%)` / brand blue `#2563EB`. Used for
  primary buttons, links, active state, focus ring, the brand mark, and the marketing CTA.
- **Marketing extends blue into a "sky" family** — Sky 400 `#38BDF8` → Sky 500 `#0EA5E9`
  → Sky 700 `#0369A1` — for gradients and soft accents, plus a warm **rose** tail.
- **Lead with neutrals.** In the product, most of any screen is **white + foreground text**;
  color marks only what needs attention. **One primary action per view.**
- **Status color language is fixed and learnable** (always paired with an icon/label,
  never color alone): **amber** = pending/expiring · **emerald** = accepted/online ·
  **blue** = active/sent · **red** = rejected/critical/destructive · **slate** = offline/expired/disabled.
- A purpose‑built **healthcare palette** (`.bg-medical-*`, `.text-medical-*`) covers
  clinical semantics beyond the base UI tokens.
- **Light mode only.** The app declares `color-scheme: light`; there is intentionally no
  dark theme — don't add `dark:` variants. All tokens are HSL CSS variables; reference the
  **semantic token**, never a raw hex.

### Type
- **No custom web font.** The native system sans stack (`ui-sans-serif, system-ui,
  -apple-system, "Segoe UI", Roboto, …`) is used for speed, native feel, and zero layout
  shift. Mono stack for code/IDs. Body is `font-sans antialiased`.
- **Type scale** follows Tailwind steps. Product UI stays in **sm–2xl (14–24px)** for
  density; **display sizes (4xl–6xl, 36–60px)** are reserved for marketing heros.
- **Weights:** 700 bold (headings, hero, card titles, numeric stats) · 600 semibold
  (badges, sub‑labels) · 500 medium (buttons — shadcn default) · 400 normal (body).
- Headings in practice: page = `text-2xl font-bold`; section = `text-lg font-bold`;
  marketing hero = `text-5xl md:text-6xl font-bold leading-tight`; muted body = `text-sm text-muted-foreground`.

### Spacing & layout
- **4px base scale.** Compose padding/gaps from steps (4·6·8·12·16·20·24·32·48·64), never
  arbitrary values. Default card padding 16–24px; section padding 32px; landing vertical
  rhythm 48–64px. Product is compact; marketing is generous.

### Radius
- One base token `--radius: 0.5rem` (8px) with derived steps: **sm 4 · md 6 (buttons,
  inputs) · lg 8 (cards, popovers, dialogs) · xl 12 / 2xl 16 (marketing cards, hero
  panels) · full 9999** (badges, avatars, status dots, pills).

### Elevation / shadows
- **Soft shadows that lift, not decorate.** `sm` for resting buttons/small cards; `md/lg`
  for primary CTAs and raised panels; `xl/2xl` for marketing hero cards, modals, and
  hover‑lifted cards. **Depth increases on hover** for clickable cards. Signature **brand
  glow** (`shadow-sky-500/30`) on the primary landing CTA, paired with `pulse-glow`.

### Backgrounds
- **Product:** flat **white** surfaces. No textures, no patterns, no decorative gradients.
- **Marketing:** signature **sky→white→rose** gradient (`#E0F2FE → #FFFFFF → #FFE4E6`),
  soft gradient panels, and clean product mockups over stock photography. Imagery stays
  **light and airy** — avoid heavy, dark, or high‑noise images. Never put PHI in imagery.

### Cards
- **Product cards:** white surface, `rounded-lg`, 1px border (`--border`), soft `shadow-sm`,
  16–24px padding. Title (bold) + content + at most **one** primary action.
- **Marketing cards:** `rounded-2xl`, gradient/tinted backgrounds, `shadow-xl`, hover‑lift.

### Borders
- 1px, `hsl(214 32% 91%)` for dividers, control borders, and input outlines. High‑contrast
  mode darkens them. Borders + soft shadow define product surfaces (not heavy outlines).

### Motion & animation
- **Purposeful, brief, and honors reduced‑motion.** In the product, motion is limited to
  **feedback, loading, and subtle state transitions**; marketing gets the expressive set.
- Library: `fade-in-up` (0.6s ease‑out, staggered with `.delay-100…600`), `bounce-in`,
  `hover-lift` (0.3s ease), `pulse-glow` (2s ∞, primary CTA), `float` (6s ∞, marketing
  accents), `animate-gradient` (8s ∞), `shimmer` (1.5s ∞, skeletons), `status-pulse`
  (1.5s ∞, presence dots), `wiggle` (icon hover delight), accordion (0.2s ease‑out).
- Easing is gentle ease‑out; **no harsh bounces in the product.** Default transitions are
  short (≈150–300ms).

### Interaction states
- **Hover:** secondary/ghost buttons get a light fill (`--secondary`); cards lift with a
  deeper shadow; links underline. **Press/active:** primary action stays solid; subtle
  darken (no aggressive shrink). **Focus:** a global `:focus-visible` rule draws a **2px
  primary outline with 2px offset** on every focusable element — never remove it.

### Transparency & blur
- Used sparingly. Marketing may use soft translucent gradient panels; the product avoids
  glassmorphism. No blur in dense clinical screens.

### Imagery vibe
- **Cool, light, airy** — sky blues and soft rose, high key, low noise. Friendly rounded
  shapes (the "Heidi‑inspired" aesthetic) on marketing; clinical neutrality in the product.

---

## 5. Iconography

- **UI icons: `lucide-react`** — a single, consistent **line/stroke icon set**. This is the
  canonical icon system across the product. In these design‑system files we load Lucide
  from CDN (the same glyph set), which matches the spec exactly.
- **Brand / company logos: `react-icons/si`** (Simple Icons) for third‑party marks.
- **Sizing:** default icon size inside buttons is **16px** (`size-4`); icons are
  non‑interactive and shrink‑protected.
- **Color:** icons inherit `currentColor`, so they follow text and status color
  automatically. Match icon color to context.
- **Meaning:** use icons to **reinforce** meaning (status, actions), **never as the sole
  carrier**. Every status color is paired with an icon **and/or** label.
- **Emoji / unicode as icons:** not used in the product UI.
- **Brand mark:** a simple wordmark + a rounded‑square **"D"** glyph. PWA icon is a white
  "D" on solid brand blue `#2563EB` with a 45px corner radius (a *maskable* icon). On the
  landing page the glyph sits in a **sky‑gradient tile**. Clear space = the height of the
  "D" on all sides. Don't recolor the glyph arbitrarily, stretch the wordmark, or place it
  on a busy photo without a solid/gradient backing.

> **Asset note:** there was no codebase to copy icons or logo files from, so the brand
> marks in `assets/` were rendered as SVG faithfully to the spec's precise description
> (white/`#2563EB`, the sky gradient, the rounded square). Swap in the real `manifest.json`
> icons + logo files if you re‑attach the repo. UI icons are pulled live from the Lucide
> CDN — no icon assets are vendored here.

---

## 6. Index — what's in this folder

| Path | Contents |
|---|---|
| `README.md` | This file — context, content + visual foundations, iconography, index. |
| `colors_and_type.css` | All design tokens as CSS variables: color (incl. healthcare + status), type scale, spacing, radius, elevation, plus semantic helper classes. **Import this in every artifact.** |
| `SKILL.md` | Agent Skill entry point (Claude Code compatible). |
| `assets/` | Brand marks: `docturn-glyph.svg` (blue PWA glyph), `docturn-glyph-sky.svg` (landing tile), `docturn-wordmark.svg`, `docturn-wordmark-marketing.svg`. |
| `preview/` | Small HTML cards rendered in the Design System tab (color, type, spacing, components, brand). |
| `ui_kits/web-app/` | Clinical web app kit — ER doctor + hospitalist + director dashboards, login, messaging. `index.html` is an interactive click‑through. |
| `ui_kits/marketing/` | DoctorHeidi marketing landing kit — hero, features, pricing, nav/footer. |
| `ui_kits/mobile/` | Expo mobile app kit — phone‑framed screens with bottom‑tab nav. |
| `uploads/` | The original source PDFs (`docturn.pdf`, `docturnstyle.pdf`). |

### Conventions for building with this system
1. `@import` or `<link>` **`colors_and_type.css`** and reference **semantic tokens**, not raw hex.
2. **Red = destructive/critical, amber = pending** — everywhere, no exceptions.
3. **Light mode only.** No `dark:` variants.
4. **One primary action per view.** Lead with neutrals; color marks attention.
5. **Pair color with icon/label.** Preserve the focus outline.
6. Product = compact + calm; marketing = generous + expressive. Same tokens, different density.
