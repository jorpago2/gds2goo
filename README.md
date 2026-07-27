# GDS2GOO

Conversor local de layouts GDSII a archivos de exposición `.goo` de una capa para la Elegoo Mars 4 9K.

## Alcance

- Lee `BOUNDARY`, `BOX`, `PATH`, `SREF` y `AREF`, incluidas magnificación, rotación y reflexión.
- Mantiene las unidades físicas del GDS y rasteriza a 8520 × 4320 píxeles de 18 µm.
- Permite seleccionar capas, desplazar, rotar, reflejar e invertir la máscara.
- Exporta `.goo` V3.0 con RLE y checksum, además de un PNG 9K de control.
- Todo el procesamiento ocurre en el navegador; el GDS no se sube.

## Ejecución

Requiere Node.js 22.13 o superior y pnpm.

```bash
pnpm install
pnpm dev
pnpm test
```

## Supuestos y seguridad experimental

El perfil está fijado a la Mars 4 9K (153,36 × 77,76 mm, 18 µm/píxel), una capa de 0,05 mm y 9 s como valor inicial. Los 9 s proceden de Wu et al., *Small Methods* 9 (2025), e01336, para LOR2A/AZ1505 y no sustituyen una matriz de dosis propia. Verifica siempre el PNG, la polaridad y la orientación en pantalla sin muestra antes de exponer fotoresist.
