# GDS2GOO

Local converter from GDSII layouts to single-layer `.goo` exposure files for the Elegoo Mars 4 9K.

**Web:** https://jorpago2.github.io/gds2goo/

## Scope

- Reads `BOUNDARY`, `BOX`, `PATH`, `SREF` and `AREF`, including magnification, rotation and reflection.
- Preserves the physical GDS units and rasterizes to 8520 × 4320 pixels at 18 µm/pixel.
- Supports layer selection, translation, rotation, mirroring and mask inversion.
- Exports GOO V3.0 with RLE and checksum, plus a 9K verification PNG.
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
