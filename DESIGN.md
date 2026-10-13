---
name: Null
description: An adversarial strategy-credibility tester — forensic, unflattering, evidence-first.
colors:
  abyss-navy: "#0A0E1A"
  slab-navy: "#121829"
  raised-navy: "#161D30"
  hairline: "#20293D"
  bone: "#E6EAF2"
  ash: "#8893A8"
  signal-lime: "#CDFF4B"
  flatline-red: "#FF5B5B"
  caution-amber: "#E8B53B"
typography:
  display:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "clamp(3rem, 13vw, 6rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "clamp(2rem, 6vw, 3.4rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.12em"
  numeric:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "100px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
components:
  button-neon:
    backgroundColor: "{colors.signal-lime}"
    textColor: "{colors.abyss-navy}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "14px 22px"
  button-neon-hover:
    backgroundColor: "{colors.signal-lime}"
    textColor: "{colors.abyss-navy}"
  button-red:
    backgroundColor: "{colors.flatline-red}"
    textColor: "#FFFFFF"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "14px 22px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ash}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "14px 22px"
  button-ghost-hover:
    backgroundColor: "transparent"
    textColor: "{colors.ash}"
  card:
    backgroundColor: "{colors.slab-navy}"
    textColor: "{colors.bone}"
    rounded: "{rounded.lg}"
    padding: "16px"
  disclaimer-chip:
    backgroundColor: "transparent"
    textColor: "{colors.ash}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
---

# Design System: Null

## Overview

**Creative North Star: "The Autopsy Table"**

Null looks like a cold, clinical examination room for trading strategies. The
interface is a dark navy slab lit from within; the user brings a strategy they
believe in, and the tool lays it out, cuts into it, and reports what it finds —
without sentiment. Everything about the surface reinforces that this is a place
where claims are examined, not celebrated. The serif carries the gravity of a
verdict; the monospace is the instrument readout clicking off real measurements;
the single neon-lime accent is the one live signal on an otherwise lightless slab.

The system is restrained to the point of austerity. There is no gloss, no gradient
buttons, no drop shadows, no decorative illustration — depth comes entirely from
tonal navy layering and hairline borders, the way a well-lit instrument panel
separates its readouts. Color is almost entirely withheld so that when it does
appear it *means* something: lime for what survives scrutiny, amber for what is
shaky, red for what is dead. The emotional register is calm, exacting, and a little
ominous — the composure of someone delivering bad news accurately.

The anti-reference is the hype-driven retail trading app: no green-up/red-down
candle cliché as decoration, no confetti, no gamified dopamine, no gradient
"to the moon" energy. Null's whole credibility rests on looking like it would
rather disappoint you than flatter you.

**Key Characteristics:**
- Dark navy "examination slab" canvas; depth by tonal layering, never shadow.
- Three-voice typography: serif *judgment*, mono *measurement*, sans *explanation*.
- One reserved accent (neon lime) carrying semantic weight, never decoration.
- A traffic-light semantic palette (lime / amber / red) tied to verdict severity.
- Numbers are always monospace and tabular — measurements, not marketing.

## Colors

A near-monochrome dark-navy foundation with one electric accent and a three-step
severity palette. The restraint is the identity: color is a signal, not a surface.

### Primary
- **Signal Lime** (`#CDFF4B`): The single live accent. Primary CTA fills, the ∅
  logo glyph, links, focus rings, the "SURVIVED" verdict, and any metric reading as
  *good*. Used sparingly and deliberately — it is the one thing on screen that
  glows.

### Secondary
- **Caution Amber** (`#E8B53B`): The middle severity. The "SHAKY" verdict and
  warning-level diagnostics (duplicate dates, calendar gaps, borderline readings).

### Tertiary
- **Flatline Red** (`#FF5B5B`): Terminal severity. The "DEAD" verdict, fatal data
  integrity failures, destructive actions, and any metric reading as *bad*. Named
  for the medical flatline — the autopsy's conclusion.

### Neutral
- **Abyss Navy** (`#0A0E1A`): The page canvas and fixed nav — the darkest layer,
  the examination room's unlit floor.
- **Slab Navy** (`#121829`): Default card and panel background — the table surface
  one step above the canvas.
- **Raised Navy** (`#161D30`): The next tonal step up for raised/nested surfaces.
- **Hairline** (`#20293D`): The 1px border/divider that separates every surface and
  rule. The system's only structural line.
- **Bone** (`#E6EAF2`): Primary text and headings — near-white, never pure white.
- **Ash** (`#8893A8`): Secondary text, mono labels, eyebrows, placeholders, muted
  framing.

### Named Rules
**The One Signal Rule.** Signal Lime appears on no more than a small fraction of any
screen. It is the live wire — a CTA, the logo, a focus ring, a surviving metric. If
lime is everywhere, nothing reads as the signal, and the whole "one live light on a
dark slab" premise collapses.

**The Color-Means-Severity Rule.** Lime / amber / red are never aesthetic choices.
They are bound to meaning: good / caution / fatal. A number is lime only when it is
genuinely good; a border tints amber or red only to mark a real warning or failure.
Never color for decoration.

## Typography

**Display Font:** Newsreader (with Georgia, serif) — weights 300/400/500, plus italic.
**Body Font:** Inter (with system-ui, sans-serif) — weights 400/500/600.
**Label/Mono Font:** JetBrains Mono (with Courier New, monospace) — weights 400/500.

**Character:** A courtroom-and-laboratory pairing. Newsreader brings editorial
gravity and delivers every verdict and headline — it is the voice of judgment.
JetBrains Mono is the instrument: every number, label, eyebrow, and button is
monospace and tabular, so figures read as measured output, not copy. Inter does the
quiet work of explanation in running prose. The three never blur roles.

### Hierarchy
- **Display** (serif, `clamp(3rem, 13vw, 6rem)`, line-height 1): The verdict word
  only — SURVIVED / SHAKY / DEAD — rendered in its severity color.
- **Headline** (serif, `clamp(2rem, 6vw, 3.4rem)`, line-height 1.15): Hero and
  screen-opening statements.
- **Verdict gloss** (serif *italic*, `clamp(1rem, 3vw, 1.25rem)`): The one-line
  headline under a verdict — the examiner's spoken summary.
- **Body** (Inter, 16px, line-height 1.6): Explanatory prose; constrained to ~460px
  measure where it stands alone.
- **Label / Eyebrow** (mono, 10–11px, letter-spacing 0.12–0.20em, UPPERCASE, Ash):
  Section eyebrows, metric labels, button text, status lines.
- **Numeric** (mono, tabular-nums, 14px–1.6rem, weight 500): Every metric value,
  colored by whether it reads good (lime) / neutral (bone) / bad (red).

### Named Rules
**The Numbers Are Mono Rule.** Every computed figure — Sharpe, drawdown, returns,
percentages, counts — is JetBrains Mono with `font-variant-numeric: tabular-nums`.
Numbers are instrument output and must align in columns like a readout; they are
never set in the serif or the sans.

**The Serif Speaks Only to Judge Rule.** Newsreader is reserved for verdicts,
headlines, and the italic gloss. It carries weight precisely because it is scarce —
never use it for UI chrome, labels, or body copy.

## Layout

A centered single-column reading model, not a dashboard grid. Content lives in a
`.container` with fluid side padding (`clamp(16px, 4vw, 24px)`) and one of three
measures: 680px (`w-2xl`), 820px (`w-3xl`), or 1040px (`w-5xl`). Screens either
fill the viewport and vertically center their payload (landing, verdict — the
"present the finding" moments) or sit below the fixed 84px top nav with generous
top/bottom breathing room (`.screen`).

Spacing rhythm is an 8/12/16/20px gap scale (`gap2`–`gap5`); 16px is the default
gutter. The primary responsive break is **760px**: metric and comparison grids
(`grid2`) collapse from two columns to one below it; the three-up key-number row
(`grid3`) holds its columns. The composition stays calm and vertical on mobile —
everything stacks, nothing reflows into density. Verified responsive to 390px.

## Elevation & Depth

**Flat by doctrine — zero box-shadows anywhere.** Depth is built entirely from
tonal navy layering and 1px hairline borders: Abyss Navy canvas → Slab Navy card →
Raised Navy nested surface, each separated by a `#20293D` hairline. This reads like
a backlit instrument panel, where readouts are distinguished by tone and rule, not
by casting shadows into a fake 3D space.

The only "glow" in the system is a single, very faint radial neon wash behind the
landing hero (`radial-gradient(..., signal-lime at ~4% opacity, transparent)`) and
the semantic tinting of verdict-meaning cards (an accent-colored border at `~27%`
alpha over an accent fill at `~5%` alpha). Both are ambient atmosphere, never
structural elevation.

### Named Rules
**The No-Shadow Rule.** Surfaces never cast shadows. If something must separate from
its background, it does so with a tonal step and a hairline border — not a shadow,
not a glow (the lime wash is a one-off hero atmosphere, not a reusable elevation).

## Shapes

A quiet, rectilinear form language with small consistent radii — closer to lab
equipment than to soft consumer UI. Radii: 6px (`sm`) for small controls, nav chips,
and focus rings; 8px (`md`) for buttons; 10px (`lg`) for cards and panels; and a full
100px pill (`pill`) reserved for the persistent disclaimer chip. Borders are always
exactly 1px, in Hairline navy, and do most of the structural work. No clipping, no
asymmetric corners, no organic shapes. The ∅ logo glyph is the one piece of
distinctive geometry — the empty-set mark that *is* the brand.

## Components

### Buttons
Monospace, uppercase, letter-spacing 0.1em — buttons read like terminal commands.
- **Shape:** 8px radius (`md`), padding `14px 22px` (hero/primary CTAs widen to
  `16px 30px`), inline-flex with a 10px gap for a trailing icon.
- **Neon (primary):** Signal Lime fill, Abyss Navy text. Hover drops to `opacity:
  0.85`. The single most prominent action on any screen.
- **Red (destructive):** Flatline Red fill, white text, same hover.
- **Ghost (secondary):** Transparent with a 1px Hairline border and Ash text; hover
  brightens the border to Ash. Carries all low-emphasis actions (SAVE, COPY LINK,
  EXPORT PINE).
- **Disabled:** `opacity: 0.4`, `cursor: not-allowed`.
- **Transitions:** opacity / border-color / background at 0.15s only.

### Cards / Containers
- **Corner Style:** 10px radius (`lg`).
- **Background:** Slab Navy (`#121829`).
- **Border:** 1px Hairline (`#20293D`). **Shadow Strategy:** none (see Elevation).
- **Internal Padding:** 16px default.
- **Semantic variant:** verdict-meaning cards swap the border to the active severity
  color at ~27% alpha over a ~5%-alpha fill of the same color, left-aligned.

### Inputs / Fields
- **Style:** Inherit the font; dark navy field, Hairline border, Ash placeholders.
- **Focus:** A 2px Signal Lime outline at 2px offset (`:focus-visible`), applied
  uniformly to every interactive element — the one global focus treatment.

### Navigation
- **Style:** Fixed full-width bar on Abyss Navy with a bottom Hairline border, 14px
  vertical padding. Left: the ∅ + "null" logo (home). Right: a mono "TEST A
  STRATEGY" chip — 1px Hairline border, 6px radius, Ash text, 11px tracked mono.

### The Verdict (signature)
The dramatic payload of the whole tool. A giant serif verdict word — **SURVIVED**
(lime) / **SHAKY** (amber) / **DEAD** (red), mapped from the engine's
PLAUSIBLE / SUSPECT / REJECTED buckets — at `clamp(3rem, 13vw, 6rem)`, announced
with `aria-live="polite"`, under a mono eyebrow and over an italic serif gloss. It
enters with a 0.7s fade-and-rise (`ease [0.16, 1, 0.3, 1]`).

### The Locked Reveal (signature)
Before the truth is revealed, metric values render behind a `blur(6px)` filter with
pointer-events and selection disabled, transitioning off over 0.4s when unlocked.
The blur *is* the "reveal the truth" dramatic beat — withheld evidence made literal.

### The Disclaimer Chip (signature)
A persistent pill (`CREDIBILITY STRESS-TEST · NOT ADVICE · NOT A SIGNAL`) in 10px
tracked mono, Ash on a Hairline-bordered pill, shown wherever numbers appear. It is
a standing honesty guardrail, not decoration.

### Status Dots
Small severity indicators use the fixed map: fatal → Flatline Red, warn → Caution
Amber, good → Signal Lime, info → Ash — the same semantics as the verdict palette.

## Do's and Don'ts

### Do:
- **Do** keep Signal Lime rare and meaningful — a CTA, the logo, a focus ring, a
  surviving metric — never a background or a decorative flourish (The One Signal Rule).
- **Do** set every computed number in JetBrains Mono with `tabular-nums`, colored by
  severity (lime good / bone neutral / red bad).
- **Do** build depth from tonal navy layering (Abyss → Slab → Raised) plus 1px
  Hairline borders.
- **Do** reserve Newsreader serif for verdicts, headlines, and the italic gloss.
- **Do** give every interactive element the 2px Signal Lime `:focus-visible` outline,
  and honor `prefers-reduced-motion`.

### Don't:
- **Don't** add box-shadows or faux-3D elevation — the system is flat by doctrine
  (The No-Shadow Rule).
- **Don't** use lime, amber, or red decoratively; each is bound to a severity meaning.
- **Don't** import hype-trading-app tropes — gradient CTAs, confetti, gamified
  dopamine, green/red candle decoration, "to the moon" energy.
- **Don't** set numbers in the serif or sans, and don't use the serif for UI chrome
  or body copy.
- **Don't** soften a DEAD/SHAKY verdict visually; it is color-coded honestly and
  presented at full size — the kill is the tool working.
