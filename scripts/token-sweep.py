#!/usr/bin/env python3
"""
Mechanical colour-token sweep over webapp/*.jsx — the tool that did the sweep,
kept in the tree so it can be re-run.

Colour VALUES only: it never moves, re-indents or restructures code, so the
diff is line-for-line and a concurrent branch merges trivially.

WHEN TO RE-RUN IT
  After merging a branch that adds screens or cards. Fresh code tends to
  arrive carrying fresh "#fff" and status hexes, and on a dark canvas those
  are white cards on a white page. Run this, then
  `node scripts/theme-check.mjs` against a fresh server to confirm.

  It is idempotent: a value already converted to var(--token) no longer
  matches, so a re-run on an untouched tree reports all zeros.

  WHITE_INK below is keyed by (file, LINE NUMBER), because "#fff" used as INK
  must be mapped per site — the right token depends on the fill underneath (a
  solid accent button takes --primary-foreground, a status chip --on-status, a
  deliberately dark panel --inverse-foreground). Those line numbers belong to
  the tree this ran against and MUST be re-derived before a re-run:

      grep -rniE '(color:|color=)[^,;}]*#(fff|ffffff)\b' webapp/*.jsx

  Everything else is file-wide and safe to re-run as it stands. webapp/
  index.html is NOT swept here (its inline shell was done by hand, 25 -> 10
  literals) — check it too after a merge.

Usage: python3 scripts/token-sweep.py      (edits webapp/*.jsx in place)
"""
import re, sys, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- lines that KEEP their literals (a justified colour, not a themeable one) --
KEEP = [
    # the fixed clinical / identity colour languages
    ("components.jsx", re.compile(r"const ESI = |^\s*[1-5]: \{ name:|SPECIALTY_PALETTE|^\s*\{ color: \"#")),
    ("Appearance.jsx", re.compile(r"^const ACCENTS|\"Blue\"\]|\"Pink\"\]|\"Cyan\"\]")),
    ("DeveloperDashboard.jsx", re.compile(r"ROLE_SWATCHES|ORG_PALETTE")),
    # the synthetic-data hazard stripe and the accent-derivation maths
    ("AppShell.jsx", re.compile(r"repeating-linear-gradient|borderBottom: \"1px solid #F59E0B|contrastRatio\(\[255|theme\.accent \|\| \"#2563EB\"|The default accent \(#2563EB|hard-code|#DBEAFE")),
    # the lock dialog paints its own always-dark canvas
    ("LockScreen.jsx", re.compile(r"linear-gradient\(160deg")),
]

def keeps(fname, line):
    for f, rx in KEEP:
        if fname == f and rx.search(line):
            return True
    return False

# --- unambiguous, file-wide hex -> token --------------------------------------
GLOBAL = {
    # accent surfaces
    "#EFF6FF": "var(--primary-tint)",
    "#DBEAFE": "var(--status-active-bg)",
    "#1D4ED8": "var(--primary-ink)",
    "#1E3A5F": "var(--primary-ink)",
    "#1E3A8A": "var(--status-active-fg)",
    "#1e3a8a": "var(--status-active-fg)",
    "#BFDBFE": "var(--status-active-rim)",
    # amber / pending
    "#B45309": "var(--status-pending)",
    "#92400E": "var(--status-pending-fg)",
    "#FEF3C7": "var(--status-pending-bg)",
    "#FCD34D": "var(--status-pending-rim)",
    # emerald / accepted
    "#047857": "var(--status-accepted)",
    "#065F46": "var(--status-accepted-fg)",
    "#D1FAE5": "var(--status-accepted-bg)",
    "#DCFCE7": "var(--status-accepted-bg)",
    "#ECFDF5": "var(--status-accepted-bg)",
    "#A7F3D0": "var(--status-accepted-rim)",
    "#6EE7B7": "var(--status-accepted-rim)",
    # red / rejected
    "#B91C1C": "var(--status-rejected)",
    "#991B1B": "var(--status-rejected-fg)",
    "#7F1D1D": "var(--status-rejected-fg)",
    "#FEE2E2": "var(--status-rejected-bg)",
    "#FEF2F2": "var(--status-rejected-bg)",
    # slate / neutral + lines
    "#F1F5F9": "var(--status-neutral-bg)",
    "#CBD5E1": "var(--border-strong)",
    "#888": "var(--muted-foreground)",
    # the deliberately dark panels and their ink
    "#1E293B": "var(--inverse)",
    "#0b1220": "var(--inverse)",
    "#172033": "var(--inverse)",
    "#94A3B8": "var(--inverse-muted)",
    "#7DD3FC": "var(--inverse-accent)",
    "#93C5FD": "var(--inverse-accent)",
    "#FDBA74": "var(--inverse-warning)",
    # translucent literals
    "rgba(255,255,255,.85)": "var(--topbar-bg)",
    "rgba(15,23,42,.35)": "var(--overlay)",
    "rgba(15,23,42,.94)": "var(--overlay-strong)",
    "rgba(37,99,235,.45)": "color-mix(in srgb, var(--primary) 45%, transparent)",
    "rgba(37,99,235,.4)": "color-mix(in srgb, var(--primary) 40%, transparent)",
    "rgba(248,113,113,.5)": "color-mix(in srgb, var(--inverse-danger) 55%, transparent)",
    "rgba(185,28,28,.25)": "color-mix(in srgb, var(--status-rejected) 28%, transparent)",
}
# #FCA5A5 is two different jobs: light-red ink/edge on the always-dark overlays
# (lock dialog, the attachment lightbox) and a rim on the light rejected tint.
PER_FILE = {
    "LockScreen.jsx": {"#FCA5A5": "var(--inverse-danger)"},
    "Messaging.jsx": {"#FCA5A5": "var(--status-rejected-rim)"},
}
PER_LINE_FCA = {("Messaging.jsx", 171): "var(--inverse-danger)"}

# --- #fff as a COLOUR: the ink token depends on the fill it sits on -----------
# (file, 1-based line) -> token. Everything else named #fff is a SURFACE.
WHITE_INK = {
    ("AccountSettings.jsx", 220): "var(--primary-foreground)",   # solid accent button
    ("AccountSettings.jsx", 238): "var(--primary-foreground)",
    ("AccountSettings.jsx", 481): "var(--on-status)",            # priority chip fill
    ("AppShell.jsx", 32): "var(--primary-foreground)",           # sidebar monogram
    ("AppShell.jsx", 248): "var(--destructive-foreground)",      # unread count
    ("Appearance.jsx", 219): "var(--primary-foreground)",        # tick on the chosen accent
    ("Appearance.jsx", 294): "var(--primary-foreground)",
    ("Appearance.jsx", 316): "var(--primary-foreground)",
    ("Broadcasts.jsx", 137): "var(--on-status)",                 # severity tile
    ("ChangePasswordScreen.jsx", 48): "var(--primary-foreground)",
    ("ComplianceMonitor.jsx", 338): "var(--inverse-foreground)",
    ("ComplianceMonitor.jsx", 345): "var(--inverse-foreground)",
    ("ComplianceOverview.jsx", 29): "var(--inverse-foreground)",
    ("DeveloperDashboard.jsx", 116): "var(--on-status)",         # tick on a role swatch
    ("DeveloperDashboard.jsx", 310): "var(--on-status)",         # tenant accent tile
    ("DeveloperDashboard.jsx", 753): "var(--inverse-foreground)",
    ("DirectorDashboard.jsx", 422): "var(--primary-foreground)",
    ("ErDoctorDashboard.jsx", 49): "var(--on-status)",           # specialty tile
    ("ErDoctorDashboard.jsx", 462): "var(--on-status)",
    ("HospitalistDashboard.jsx", 115): "var(--on-status)",
    ("InstallPrompt.jsx", 63): "var(--primary-foreground)",
    ("InstallPrompt.jsx", 64): "var(--primary-foreground)",
    ("InstallPrompt.jsx", 69): "var(--primary-foreground)",
    ("InstallPrompt.jsx", 70): "var(--primary-foreground)",
    ("Integrations.jsx", 55): "var(--primary-foreground)",
    ("LockScreen.jsx", 137): "var(--inverse-foreground)",
    ("LockScreen.jsx", 147): "var(--inverse-foreground)",
    ("LockScreen.jsx", 155): "var(--inverse-foreground)",
    ("LockScreen.jsx", 164): "var(--inverse-foreground)",
    ("LockScreen.jsx", 176): "var(--primary-foreground)",
    ("LoginScreen.jsx", 157): "var(--primary-foreground)",
    ("Messaging.jsx", 151): "var(--inverse-foreground)",
    ("Messaging.jsx", 155): "var(--inverse-foreground)",
    ("Messaging.jsx", 161): "var(--inverse-foreground)",
    ("Messaging.jsx", 164): "var(--inverse-foreground)",
    ("Messaging.jsx", 168): "var(--inverse-foreground)",
    ("Messaging.jsx", 170): "var(--inverse-foreground)",
    ("Messaging.jsx", 173): "var(--inverse-foreground)",
    ("Messaging.jsx", 182): "var(--inverse-foreground)",
    ("Messaging.jsx", 183): "var(--inverse-foreground)",
    ("Messaging.jsx", 287): "var(--destructive-foreground)",
    ("Messaging.jsx", 650): "var(--on-status)",
    ("Messaging.jsx", 653): "var(--primary-foreground)",
    ("Messaging.jsx", 834): "var(--primary-foreground)",
    ("Messaging.jsx", 882): "var(--primary-foreground)",
    ("Messaging.jsx", 1026): "var(--on-status)",
    ("Messaging.jsx", 1036): "var(--primary-foreground)",
    ("Messaging.jsx", 1058): "var(--on-status)",
    ("Messaging.jsx", 1080): "var(--primary-foreground)",
    ("Messaging.jsx", 1171): "var(--on-status)",
    ("MfaScreen.jsx", 28): "var(--primary-foreground)",
    ("PatientBoard.jsx", 136): "var(--primary-foreground)",
    ("SupportDirectory.jsx", 28): "var(--inverse-foreground)",
    ("SupportDirectory.jsx", 53): "var(--primary-foreground)",
    ("components.jsx", 39): "var(--primary-foreground)",
    ("components.jsx", 40): "var(--destructive-foreground)",
    ("components.jsx", 79): "var(--destructive-foreground)",
    ("components.jsx", 80): "var(--primary-foreground)",
}

COLOR_PROP = re.compile(r"(?<![A-Za-z-])color\s*[:=]\s*")

def color_value_spans(line):
    """Spans of the VALUE of every `color:` / `color=` in the line."""
    spans = []
    for m in COLOR_PROP.finditer(line):
        i = m.end()
        depth = 0
        j = i
        while j < len(line):
            c = line[j]
            if c in "([{":
                depth += 1
            elif c in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif c == "," and depth == 0:
                break
            j += 1
        spans.append((i, j))
    return spans

def in_spans(pos, spans):
    return any(a <= pos < b for a, b in spans)

def sub_in_spans(line, spans, pattern, repl):
    out, last = [], 0
    for m in pattern.finditer(line):
        if in_spans(m.start(), spans):
            out.append(line[last:m.start()]); out.append(repl); last = m.end()
    out.append(line[last:])
    return "".join(out)

WHITE = re.compile(r'#(?:fff|ffffff|FFF|FFFFFF)\b')
PRIMARY_VAR = re.compile(r'var\(--primary\)')

total = {"global": 0, "ink": 0, "surface": 0, "primary_ink": 0}
for path in sorted(glob.glob(os.path.join(ROOT, "webapp", "*.jsx"))):
    fname = os.path.basename(path)
    src = open(path).read().split("\n")
    out = []
    for n, line in enumerate(src, 1):
        orig = line
        if not keeps(fname, line):
            # 1. unambiguous hex / rgba -> token
            table = dict(GLOBAL)
            table.update(PER_FILE.get(fname, {}))
            if (fname, n) in PER_LINE_FCA:
                table["#FCA5A5"] = PER_LINE_FCA[(fname, n)]
            for k in sorted(table, key=len, reverse=True):
                if k in line:
                    total["global"] += line.count(k)
                    line = line.replace(k, table[k])
            # 2. --primary used as TEXT becomes --primary-ink (the accent as a
            #    fill stays exactly the colour the operator chose)
            spans = color_value_spans(line)
            if spans:
                before = line
                line = sub_in_spans(line, spans, PRIMARY_VAR, "var(--primary-ink)")
                total["primary_ink"] += (len(before) != len(line)) and before.count("var(--primary)") - line.count("var(--primary)") or 0
            # 3. #fff as INK on a fill (per-line token), then as a SURFACE
            spans = color_value_spans(line)
            ink = WHITE_INK.get((fname, n))
            if ink and spans:
                c = len([m for m in WHITE.finditer(line) if in_spans(m.start(), spans)])
                line = sub_in_spans(line, spans, WHITE, ink)
                total["ink"] += c
            if WHITE.search(line):
                total["surface"] += len(WHITE.findall(line))
                line = WHITE.sub("var(--card)", line)
        out.append(line)
    new = "\n".join(out)
    if new != "\n".join(src):
        open(path, "w").write(new)
print(total)
