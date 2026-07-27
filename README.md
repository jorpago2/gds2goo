# GDS2GOO

Local converter from GDSII layouts to single-layer `.goo` exposure files for the Elegoo Mars 4 9K.

**Web:** https://jorpago2.github.io/gds2goo/

## Scope

- Reads `BOUNDARY`, `BOX`, `PATH`, `SREF` and `AREF`, including magnification, rotation and reflection.
- Preserves the physical GDS units and rasterizes to 8520 × 4320 pixels at 18 µm/pixel.
- Supports layer selection, preview zoom and grid, translation, rotation, mirroring and mask inversion.
- Supports layout-centre, GDS-origin and lower-left placement anchors, with clipping validation after all transformations.
- Includes a native 64 × 64 pixel inspector and a true 8520 × 4320 LCD pixel grid at 8× zoom.
- Generates a built-in 18–180 µm line/space calibration mask and exposure-time series.
- Exports GOO V3.0 with RLE and checksum, plus a 9K verification PNG.
- Exports a companion `.run.json` manifest with the GDS SHA-256, mask settings and optional process metadata.
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

The profile is fixed to the Mars 4 9K (153.36 × 77.76 mm, 18 µm/pixel), one 0.05 mm layer and 9 s as an initial value. The 9 s value comes from Wu et al., *Small Methods* 9 (2025), e01336, for LOR2A/AZ1505 and does not replace a process-specific dose matrix. Always verify the PNG, polarity and on-screen orientation without a sample before exposing photoresist.
