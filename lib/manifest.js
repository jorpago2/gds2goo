export function createRunManifest({ source, mask, exposures, process, outputs }) {
  if (!source || !outputs.length || !exposures.length) throw new Error("The run manifest is incomplete.");
  return {
    schema: "gds2goo-run-manifest/v1",
    generatedAt: new Date().toISOString(),
    application: {
      name: "GDS2GOO",
      version: "0.2.0",
      url: "https://jorpago2.github.io/gds2goo/",
    },
    source,
    printer: {
      model: "Elegoo Mars 4 9K",
      lcdPixels: [8520, 4320],
      lcdSizeMillimeters: [153.36, 77.76],
      pixelPitchMicrometers: 18,
      wavelengthNanometers: 405,
    },
    mask,
    exposuresSeconds: exposures,
    process: {
      photoresist: process.photoresist.trim() || null,
      thicknessNanometers: process.thicknessNm ? Number(process.thicknessNm) : null,
      softBake: process.softBake.trim() || null,
      development: process.development.trim() || null,
      notes: process.notes.trim() || null,
    },
    outputs,
  };
}
