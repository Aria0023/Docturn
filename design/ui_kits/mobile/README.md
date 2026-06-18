# DocTurn — Mobile App UI Kit (Expo / React Native)

A high-fidelity recreation of the DocTurn mobile app, framed in an iOS device bezel. Open
**`index.html`** and tap through the bottom tabs.

> Built from the engineering spec's mobile section (Expo SDK 52 / RN 0.76, bottom-tab nav).
> The real codebase mount was empty, so this is a faithful interpretation.

## Tabs (bottom navigation)
| Tab | Screen |
|---|---|
| **Dashboard** | Census stats, On-shift toggle, accept/decline incoming assignments. |
| **Messages** | Conversation list with presence dots + unread counts. |
| **Care Team** | Providers grouped by on-shift / off-shift, with live presence. |
| **Directory** | Searchable org-wide provider list. |
| **Profile** | Identity, 2FA, notifications, org, session, sign out. |

## Files
| File | What it is |
|---|---|
| `index.html` | Device frame + bottom-tab state machine + viewport auto-fit scaler. |
| `screens.jsx` | All five screens + mobile primitives (`MI`, `MBadge`, `MAvatar`, `Dot`). |
| `ios-frame.jsx` | iOS device bezel starter (status bar, dynamic island, home indicator). |
| `tokens.css` | Copy of the root design tokens. |
| `assets/` | DocTurn glyph. |

## Brand notes honored
- **Touch-first:** larger hit targets (≥44px), portrait-first layout, same tokens as web.
- Status color language identical to the product (amber/emerald/blue/red/slate), always with icon + label.
- Light mode only; rounded cards, soft shadows; Lucide icons; initials-only PHI.
- The device auto-scales to fit the viewport.
