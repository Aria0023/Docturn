/**
 * Status-bar and safe-area colours follow the page's theme-color. Pure
 * (tests/mobile-shell.test.ts).
 */
export interface Rgb { r: number; g: number; b: number }

/** "#RGB", "#RRGGBB", "rgb(r, g, b)" or "rgba(r, g, b, a)" (an alpha of 0 — a transparent body — is no colour). */
export function parseColor(input: string | null | undefined): Rgb | null {
  const s = String(input || "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1]!;
    return { r: parseInt(h[0]! + h[0]!, 16), g: parseInt(h[1]! + h[1]!, 16), b: parseInt(h[2]! + h[2]!, 16) };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const h = m[1]!;
    if (m[2] !== undefined && parseInt(m[2], 16) === 0) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(s);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }
  return null;
}

export function toHex(c: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Relative luminance (sRGB, WCAG) — above 0.5 the bar needs dark icons. */
export function luminance(c: Rgb): number {
  const ch = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export function isLight(c: Rgb): boolean {
  return luminance(c) > 0.5;
}
