# Design — GDS2GOO

A locked visual system for the GDS-to-GOO laboratory workspace. Functional and scientific behaviour remains independent from this document.

## Genre

Modern-minimal, with a technical and austere voice.

## Macrostructure family

- App pages: Workbench — preview-led, compact workflow rail, advanced parameters disclosed on demand.
- Content pages: Long Document — typography only, no enrichment.
- Marketing pages: Workbench — real product captures only; no fabricated chrome or metrics.

## Theme

Coral adapted to the existing GDS2GOO identity: warm paper, near-black ink and signal orange used only for active or safety-relevant states.

## Typography

- Display: IBM Plex Mono, weight 600–700, roman.
- Body: IBM Plex Sans, weight 400–600.
- Display tracking: `-0.025em`.
- Type scale anchor: `--text-display: clamp(2.2rem, 3vw + 1rem, 4.25rem)`.

## Spacing

4-point named scale defined in `tokens.css`. Interface code uses named tokens rather than raw spacing values when new rules are added.

## Motion

- State changes use `--ease-out`, `--ease-in` and `--ease-in-out`.
- Only transform and opacity may animate.
- Reduced motion is opacity-only and at most 150 ms.

## Microinteractions stance

- Silent success; status text reports work that is not otherwise visible.
- Focus is immediate and visible.
- Button press is the only spatial microinteraction.

## CTA voice

- Primary: dark filled, compact, verb-led.
- Secondary: quiet outline, same height and radius.

## Per-page allowances

- App pages use no decorative enrichment; the mask preview is the visual anchor.
- Scientific warnings retain explicit icon and text signals.
- Print output may use a separate monochrome token subset.

## What pages MUST share

- GDS2GOO wordmark and orange signal.
- IBM Plex Mono + IBM Plex Sans pairing.
- Control height, focus ring, disclosure and action hierarchy.
- Warm paper and the same semantic status colours.

## What pages MAY differ on

- Inspector density and the number of visible disclosure groups.
- Preview aspect ratio when another printer profile is added.
- Footer content while retaining the inline-rule form.

## Exports

### tokens.css

`tokens.css` at the project root is the source of truth.

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(97% 0.012 75);
  --color-ink: oklch(17% 0.012 62);
  --color-accent: oklch(62% 0.22 39);
  --color-focus: oklch(45% 0.17 245);
  --font-display: "IBM Plex Mono", ui-monospace, monospace;
  --font-body: "IBM Plex Sans", ui-sans-serif, sans-serif;
  --spacing-md: 1.5rem;
  --radius-input: 0.375rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(97% 0.012 75)", "$type": "color" },
    "ink": { "$value": "oklch(17% 0.012 62)", "$type": "color" },
    "accent": { "$value": "oklch(62% 0.22 39)", "$type": "color" },
    "focus": { "$value": "oklch(45% 0.17 245)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "IBM Plex Mono, ui-monospace, monospace", "$type": "fontFamily" },
    "body": { "$value": "IBM Plex Sans, ui-sans-serif, sans-serif", "$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1.5rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 97% 0.012 75;
  --foreground: 17% 0.012 62;
  --primary: 62% 0.22 39;
  --primary-foreground: 98% 0.01 75;
  --secondary: 91% 0.016 75;
  --secondary-foreground: 27% 0.012 65;
  --muted: 85% 0.014 75;
  --muted-foreground: 45% 0.014 68;
  --border: 85% 0.014 75;
  --input: 70% 0.018 72;
  --ring: 45% 0.17 245;
  --radius: 0.375rem;
}
```
