# GDS2GOO

Local converter from GDSII layouts to single-layer `.goo` exposure files for the Elegoo Mars 4 9K.

**Web:** https://jorpago2.github.io/gds2goo/

## Scope

- Reads `BOUNDARY`, `BOX`, `PATH`, `SREF` and `AREF`, including magnification, rotation and reflection.
- Preserves the physical GDS units and rasterizes to 8520 × 4320 pixels at 18 µm/pixel using a deterministic pixel-centre rule.
- Supports layer selection, slider/wheel/pinch preview zoom, full-screen inspection and a native-pixel grid, plus a two-point measurement tool.
- Provides independent substrate translation and rotation, configurable edge exclusion, wafer flats/notches, custom circular/rectangular templates, and optional outline rasterization.
- Generates exportable crosses, corner brackets, targets and a 10 mm ruler for alignment.
- Creates centred step-and-repeat arrays of up to 10 × 10 copies with independent X/Y pitch.
- Exports one validated GOO per selected layer when independent exposure times are required.
- Supports layout-centre, GDS-origin and lower-left placement anchors, with clipping validation after all transformations.
- Includes a native 64 × 64 pixel inspector and a true 8520 × 4320 LCD pixel grid at 8× zoom.
- Generates a built-in 18–180 µm line/space calibration mask and exposure-time series.
- Generates an asymmetric LCD diagnostic for orientation, polarity, clipping and a 10.008 mm scale check.
- Reports exposure-relevant GDS compatibility warnings instead of silently omitting unsupported geometry.
- Exports GOO V3.0 with RLE and checksum, plus a 9K verification PNG.
- Exports a companion `.run.json` manifest with the GDS SHA-256, mask settings and optional process metadata.
- Restores validated `.run.json` recipes and verifies their printer profile and source SHA-256.
- Stores reusable exposure/process recipes locally in the browser; layout geometry is deliberately excluded.
- Packages GOO, PNG and manifest files into a standard ZIP and provides an A4 experimental run sheet.
- All processing happens in the browser; the GDS file is never uploaded.

## Run locally

Requires Node.js 22.13 or later and pnpm.

```bash
pnpm install
pnpm dev
pnpm test
```

Every change to `main` is published automatically to GitHub Pages through GitHub Actions.

## Assumptions and experimental safety

The 2-inch and 3-inch primary-flat guides use the nominal SEMI M1 lengths of 15.88 mm and 22.22 mm. The 1-inch flat is a non-standard 4 mm placement guide. The optional 1 mm-deep, 90° notch follows SEMI geometry but is only a visual reference here: SEMI specifies that notch for 200 mm and 300 mm silicon wafers, not for these smaller formats.

Substrate outlines are preview-only by default. Enabling `Include outline in mask` rasterizes the outline into GOO and PNG outputs at a configurable width of 36–1000 µm. Selected alignment marks are always exported. The dashed edge-exclusion boundary is only a placement guide and is never exposed. Crossing it produces a warning rather than blocking export because the final decision depends on the physical fixture and process.

The step-and-repeat pitch is centre-to-centre and the array is centred around the source layout. In a per-layer exposure ZIP, alignment marks and the optional substrate outline are included only in the first GOO to avoid unintentionally dosing them once per layer. The run manifest records every substrate, array, alignment and per-layer exposure setting.

The profile is fixed to the Mars 4 9K (153.36 × 77.76 mm, 18 µm/pixel), one 0.05 mm layer and 9 s as an initial value. The 9 s value comes from Wu et al., *Small Methods* 9 (2025), e01336, for LOR2A/AZ1505 and does not replace a process-specific dose matrix. Always verify the PNG, polarity and on-screen orientation without a sample before exposing photoresist.

The automated checks include a human-readable native-pixel mask, an independent GOO layer decoder and a fixed byte-level GOO reference. UVtools 6.1.0 independently decoded the calibration reference with the same 341,880 active pixels and 7,322 × 2,442 px bounds. This is not printer certification: before experimental use, validate orientation, polarity and exposure on the target printer without photoresist.
