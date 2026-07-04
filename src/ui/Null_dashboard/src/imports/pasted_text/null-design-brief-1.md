FIGMA DESIGN PROMPT — "NULL"

To the design AI: Design the complete visual identity and UI for a product called Null. This is a design brief, not an engineering one — your job is the look, the screens, the components, and the feel. Follow it precisely. The single most important rule lives in the "Restraint" section: this theme can very easily collapse into the generic dark-app-with-neon-glow cliché, and the only thing that saves it is discipline. Spend the boldness in one place and keep everything else cold and quiet.


1. WHAT NULL IS (so your design has a point of view)

Null is a trading-strategy credibility tester. A user describes a strategy; Null assumes it's worthless and forces it to prove otherwise on data it has never seen, after real costs. The name is the thesis: in statistics, the null hypothesis (H₀) is "there is no effect, no edge." You don't get to claim an edge — you have to reject H₀ with evidence.

So the personality is: a skeptic's instrument. Cold, precise, clinical, a little brutal. Closer to a lab readout or a research terminal than a hype-y trading app — but more editorial and considered than a Bloomberg clone. It should feel like a tool that respects the user enough to tell them the truth.

The emotional arc the whole design serves: seduction, then truth. The user falls in love with a beautiful result, then the tool pulls the cover off. Your palette and your one signature interaction must carry that arc.


2. IDENTITY & MARK


Wordmark: "Null", set in the display serif, lowercase or small-caps — confident, restrained.
Symbol: the empty-set glyph ∅ and the statistical H₀ are the identity motifs. Use ∅ as the app icon / loading mark; use H₀ in the verdict language.
The signature phrase is the success state: a strategy that survives is shown as "Reject H₀." Build the verdict system around this (see §6). It's the detail that signals the maker actually understands what they built — get it statistically correct, don't invert it.



3. COLOR (dark only — define these as Figma color variables, named semantically)

The base is a dark blue-black, never pure black — the blue is what keeps it from looking like every other AI-default dark theme.

TokenHexUsebg/canvas#0A0E1Aapp backgroundsurface/panel#121829cards, panelssurface/raised#161D30elevated elements, inputsborder/hairline#20293Ddividers, panel edges, grid linestext/primary#E6EAF2headings, body (cool off-white, not warm)text/muted#8893A8secondary text, labelssignal/neon#CDFF4Bscarce — the in-sample "edge," the primary CTA, the ∅ accent. Nowhere else.truth/red#FF5B5Bout-of-sample reality, rejection, the revealcaution/amber#E8B53Bthe "weak evidence" middle verdict only

The palette tells the story by itself: neon yellow-green is the lie you're tempted by (in-sample), red is the reality (out-of-sample). The contrast does the emotional work. The neon must feel rationed — if it appears in more than about three places on any screen, you've broken the design.


4. TYPOGRAPHY (define as Figma text styles with a clear scale)

Three roles, deliberately paired:


Display (serif): a high-contrast, editorial serif (e.g., Spectral / Newsreader / a similar refined serif) for headlines and the verdict word. Gives gravity and a research-paper authority. Used big, used sparingly.
Data (monospace): a monospace with tabular figures (e.g., JetBrains Mono / IBM Plex Mono / Space Mono) for every number, metric, and code block. Numbers must read as instrument output, not marketing.
UI / body (grotesque sans): a clean neutral sans (e.g., Inter / Geist) for controls, labels, and prose.


Set an intentional scale (e.g., display 48/36/28, body 16/14, mono 14/12, eyebrow 11 letter-spaced uppercase in text/muted). Eyebrows and data labels in spaced uppercase mono reinforce the lab-instrument feel.


5. LAYOUT, SPACING, SHAPE


4px base grid. Generous negative space — the clinical feel comes from breathing room, not density.
Restrained radii: ~10px on panels, ~8px on controls. No pills, no big rounded blobs — soft-but-precise signals an instrument, not a toy.
Hairline 1px borders in border/hairline to separate structure. Thin rules, not heavy boxes.
Design every screen at two frames: Mobile 390×844 and Desktop 1440×1024. Mobile-first — this becomes a phone app later, so nothing may be desktop-only. Use Auto Layout throughout so it's clearly responsive.



6. SCREENS TO DESIGN (use the real microcopy provided — no lorem)

6.1 Identity / cover frame. Logo lockup, the ∅ and H₀ marks in a few sizes, the color variables as swatches, and a type specimen. This is the style reference page.

6.2 Landing / hero. Mostly empty dark canvas. One thesis headline in the serif:


"Assume your strategy has no edge. Now make it prove otherwise."



Subline in muted sans: "Null tests trading strategies the way a skeptic would — on data they've never seen, after real costs." A single neon CTA: Test a strategy. The ∅ mark present but quiet. Resist adding hero stats or gradient blobs.

6.3 Strategy input. A segmented toggle English | Pine Script. A large textarea with a quiet placeholder ("e.g. go long when the 50-day average crosses above the 200-day; exit on a 5% stop"). A row of example chips that fill it. An instrument multi-select and a date range. Primary CTA: Run the test.

6.4 Parsing state. Honest, calm. The ∅ mark with microcopy "Reading your strategy…" — no generic spinner.

6.5 "What I understood" confirmation. The parsed rules rendered as plain-language labeled tokens (e.g., ENTRY · 50-day SMA crosses above 200-day SMA, EXIT · 5% stop-loss). Anything the parser couldn't represent is flagged in truth/red with a short note. Two actions: Looks right — test it / Edit. This screen is part of the product's honesty; make it feel considered, not like a debug dump.

6.6 Results — pre-reveal (tension frame). The in-sample equity curve glows in signal/neon; a dashed text/muted line is buy-&-hold. The in-sample metrics panel is fully visible. The out-of-sample panel beside it is locked — blurred, with a small lock and a truth/red button: Reveal the truth, and the line "You haven't earned this number yet."*

6.7 Results — post-reveal (THE SIGNATURE). The out-of-sample portion of the curve draws in truth/red, falling away from the neon line the user fell in love with. The OOS panel un-blurs. A before / after costs toggle sits nearby. This single transition is the heart of the product — everything else on the page stays quiet so this lands hard. Prototype it: tapping "Reveal the truth" smart-animates the red curve in and removes the blur.

6.8 Verdict. A large serif verdict, color-coded, with statistically correct H₀ language and a one-line evidence sentence in mono/sans:


Edge survived → REJECT H₀ in signal/neon — "An edge survived out-of-sample and after costs."
Borderline → H₀ STANDS — for now in caution/amber — "Most of the shine was overfitting. Weak evidence."
Failed → FAIL TO REJECT H₀ in truth/red — "No edge on unseen data. This is a curve fit."


6.9 Pine Script export. A styled code block (monospace, surface/raised, hairline border), a "generated" label, a copy button. Unsupported constructs appear as commented notes, not faked.

6.10 Empty & error states. Written in the interface's own honest voice — errors explain what happened and how to fix it; they don't apologize or go vague. An empty input is an invitation, not a void.


7. COMPONENTS (build as Figma components with variants)


Button — variants: primary (neon, dark text), ghost (hairline border), danger (red); states: default / hover / focus-visible / disabled.
Segmented toggle (English/Pine, before/after costs).
Example chip / tag.
Metric row — label (muted) + value (mono), with good/bad color variants pulling neon vs red.
Panel — base, plus top-accent variants (neon top-border for in-sample, red for out-of-sample).
Locked overlay — blur + lock + reveal CTA.
Verdict card — three variants matching §6.8.
Chart spec — hairline grid, muted axes, neon in-sample line (weight ~2.5), red out-of-sample line, dashed muted benchmark; an in-sample shaded region at very low neon opacity; a vertical "unseen →" marker at the split.
Inputs — textarea, select, date range, slider (neon accent), all with visible keyboard focus.
Logo component — the ∅ / Null lockup.



8. RESTRAINT & QUALITY FLOOR (the rule that makes or breaks this)


Spend the neon in one place. In-sample curve + primary CTA + the ∅ accent. That's roughly it. The instant neon shows up as borders, icons, hovers, and headings all at once, the design becomes the generic dark-neon cliché you must avoid. Cool dark + off-white carries the other 95%.
One orchestrated motion: the reveal. Everything else is still or near-still. Extra animation reads as AI-generated; resist it.
Quality floor, non-negotiable: visible keyboard focus rings, contrast that passes for text, reduced-motion respected, and full mobile responsiveness. The 390px frames must look intentional, not squeezed.
Before you call it done, do the Chanel test — look at each screen and remove one accessory. If a decorative element doesn't carry meaning (the neon = edge, red = reality, mono = real data), cut it.


Deliver: an identity/cover frame, all ten screens at both mobile and desktop sizes, a components page with variants, defined color and text variables/styles, and a prototyped "Reveal the truth" interaction.