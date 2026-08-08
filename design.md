# Design — GDS2GOO

This document is the visual contract for the GDS-to-GOO laboratory workspace. Scientific behaviour is independent from it.

## System of record

- Carbon Design System, theme `g10`, is the sole screen-interface foundation.
- `@carbon/react` components own controls, notifications, focus, states, surfaces, shape and elevation.
- IBM Plex Sans is the interface typeface. IBM Plex Mono is reserved for measurements, coordinates, hashes and machine-readable values.
- Carbon semantic tokens are used directly for application colours. GDS2GOO does not maintain a parallel UI palette.

## Interface structure

- Workbench layout: compact workflow navigation, one task panel, a preview-led main area and a concise status bar.
- Progressive disclosure keeps advanced parameters behind panels and accordions.
- Actions follow Carbon hierarchy: primary for the current outcome, secondary or tertiary for supporting actions, danger only for destructive actions.
- Status, guidance and compatibility messages use Carbon notification components instead of bespoke cards.
- Form and action groups may use Carbon `Layer`; custom card backgrounds, shadows and radii are not permitted outside the viewer.

## Scientific viewer exception

The LCD preview is a scientific instrument surface rather than application chrome. It may use the dedicated `--viewer-*` tokens in `tokens.css` for the dark canvas, geometry, grid, guides and measurement overlays. Controls around the canvas remain Carbon components and surfaces.

## Responsive behaviour

- Desktop keeps the workflow rail, task panel, preview and optional inspector visible where space permits.
- Narrow screens turn the workflow rail into bottom navigation and show panels as full-width overlays.
- No breakpoint may introduce a second visual language, horizontal page overflow or clipped primary controls.

## Printing

The run sheet may use the monochrome `--print-*` tokens in `tokens.css`. These tokens are print-only and must not style the screen interface.

## Prohibited inheritance

- No Coral, warm-paper, orange-signal, reflectometry or Storybook starter styling.
- No Tailwind, shadcn or external theme token exports.
- No custom UI status palette, rounded-card system or elevation system alongside Carbon.
- No new selector that restyles Carbon internals unless the component API cannot express a required scientific-workbench layout and the exception is documented.
