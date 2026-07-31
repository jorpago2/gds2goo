/** Photoresists explicitly documented for the Mars 4 9K wavelength in SpinCoatSim. */
export const PHOTORESISTS_405_NM = [
  { id: "s1805", manufacturer: "Kayaku / Qnity", name: "MICROPOSIT S1805", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 500, referenceRpm: 4000, evidence: "Approx. from manufacturer spin curve", sourceUrl: "https://kayakuam.com/wp-content/uploads/2019/10/S1800_Photoresist.pdf" },
  { id: "s1811", manufacturer: "Kayaku / Qnity", name: "MICROPOSIT S1811", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1100, referenceRpm: 4000, evidence: "Approx. from manufacturer spin curve", sourceUrl: "https://kayakuam.com/wp-content/uploads/2019/10/S1800_Photoresist.pdf" },
  { id: "s1813", manufacturer: "Kayaku / Qnity", name: "MICROPOSIT S1813", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1300, referenceRpm: 4000, evidence: "Approx. from manufacturer spin curve", sourceUrl: "https://kayakuam.com/wp-content/uploads/2019/10/S1800_Photoresist.pdf" },
  { id: "s1818", manufacturer: "Kayaku / Qnity", name: "MICROPOSIT S1818", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1800, referenceRpm: 4000, evidence: "Approx. from manufacturer spin curve", sourceUrl: "https://kayakuam.com/wp-content/uploads/2019/10/S1800_Photoresist.pdf" },
  { id: "s1822", manufacturer: "Kayaku / Qnity", name: "MICROPOSIT S1822", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 2200, referenceRpm: 4000, evidence: "Approx. from manufacturer spin curve", sourceUrl: "https://kayakuam.com/wp-content/uploads/2019/10/S1800_Photoresist.pdf" },
  { id: "su8-tf-6000-5", manufacturer: "Kayaku", name: "SU-8 TF 6000.5", tone: "Negative epoxy", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 500, referenceRpm: 3000, referenceDoseMjCm2: [40, 80], referenceDoseBasis: "broadband h/i/g-line baseline at 0.5 µm on Si; wavelength-dependent", evidence: "Approx. from manufacturer spin curve", sourceUrl: "https://kayakuam.com/wp-content/uploads/2019/09/SU-8-TF-6000.Data-Sheet.v2-3.18.pdf" },
  { id: "az-5214e", manufacturer: "AZ / Merck", name: "AZ 5214E", tone: "Image reversal", exposureWavelengthsNm: [365, 405], referenceThicknessNm: 1400, referenceRpm: 4000, evidence: "Manufacturer spin-curve point", sourceUrl: "https://www.microchemicals.com/dokumente/datenblaetter/tds/merck/en/tds_az_5214e_photoresist.pdf" },
  { id: "az-1505", manufacturer: "AZ / Merck", name: "AZ 1505", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 500, referenceRpm: 4000, evidence: "Manufacturer nominal point", sourceUrl: "https://www.microchemicals.com/dokumente/datenblaetter/tds/merck/en/tds_az_1500_series.pdf" },
  { id: "az-1512hs", manufacturer: "AZ / Merck", name: "AZ 1512 HS", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1300, referenceRpm: 4000, evidence: "Manufacturer nominal point", sourceUrl: "https://www.microchemicals.com/dokumente/datenblaetter/tds/merck/en/tds_az_1500_series.pdf" },
  { id: "az-1514h", manufacturer: "AZ / Merck", name: "AZ 1514 H", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1500, referenceRpm: 4000, evidence: "Manufacturer nominal point", sourceUrl: "https://www.microchemicals.com/dokumente/datenblaetter/tds/merck/en/tds_az_1500_series.pdf" },
  { id: "az-1518", manufacturer: "AZ / Merck", name: "AZ 1518", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1800, referenceRpm: 4000, evidence: "Manufacturer nominal point", sourceUrl: "https://www.microchemicals.com/dokumente/datenblaetter/tds/merck/en/tds_az_1500_series.pdf" },
  { id: "ma-p-1205", manufacturer: "Microresist", name: "ma-P 1205", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 500, referenceRpm: 3000, evidence: "Manufacturer nominal point", sourceUrl: "https://microresist.de/en/produkt/ma-p-1200-series-ma-p-1275-hv/" },
  { id: "ma-p-1210", manufacturer: "Microresist", name: "ma-P 1210", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1000, referenceRpm: 3000, evidence: "Manufacturer nominal point", sourceUrl: "https://microresist.de/en/produkt/ma-p-1200-series-ma-p-1275-hv/" },
  { id: "ma-p-1215", manufacturer: "Microresist", name: "ma-P 1215", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1500, referenceRpm: 3000, evidence: "Manufacturer nominal point", sourceUrl: "https://microresist.de/en/produkt/ma-p-1200-series-ma-p-1275-hv/" },
  { id: "ma-p-1225", manufacturer: "Microresist", name: "ma-P 1225", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 2500, referenceRpm: 3000, evidence: "Manufacturer nominal point", sourceUrl: "https://microresist.de/en/produkt/ma-p-1200-series-ma-p-1275-hv/" },
  { id: "ma-p-1240", manufacturer: "Microresist", name: "ma-P 1240", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 4000, referenceRpm: 3000, evidence: "Manufacturer nominal point", sourceUrl: "https://microresist.de/en/produkt/ma-p-1200-series-ma-p-1275-hv/" },
  { id: "ma-p-1275hv", manufacturer: "Microresist", name: "ma-P 1275HV", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 11000, referenceRpm: 3000, evidence: "Manufacturer nominal point", sourceUrl: "https://microresist.de/en/produkt/ma-p-1200-series-ma-p-1275-hv/" },
  { id: "mr-p-1201lil", manufacturer: "Microresist", name: "mr-P 1201LIL", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 100, referenceRpm: 3000, referenceDoseMjCm2: [15, 50], referenceDoseBasis: "405 nm laser interference lithography", evidence: "Manufacturer nominal point; 15–50 mJ/cm² at 405 nm", sourceUrl: "https://www.microresist.de/en/produkt/ma-p-1200-lil-series/" },
  { id: "mr-p-1202lil", manufacturer: "Microresist", name: "mr-P 1202LIL", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 200, referenceRpm: 3000, referenceDoseMjCm2: [15, 50], referenceDoseBasis: "405 nm laser interference lithography", evidence: "Manufacturer nominal point; 15–50 mJ/cm² at 405 nm", sourceUrl: "https://www.microresist.de/en/produkt/ma-p-1200-lil-series/" },
  { id: "ar-p-3740", manufacturer: "Allresist", name: "AR-P 3740", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1400, referenceRpm: 4000, documentedContrast: 6, referenceDoseMjCm2: [55, 55], referenceDoseBasis: "E₀, broadband UV stepper at 1.4 µm", evidence: "Manufacturer nominal point", sourceUrl: "https://www.allresist.com/wp-content/uploads/sites/2/2020/03/AR-P3700_3800_english_Allresist_product_information.pdf" },
  { id: "ar-p-3510", manufacturer: "Allresist", name: "AR-P 3510", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 2000, referenceRpm: 4000, documentedContrast: 4, referenceDoseMjCm2: [55, 55], referenceDoseBasis: "E₀, broadband UV stepper at 2.0 µm", evidence: "Manufacturer nominal point", sourceUrl: "https://www.allresist.com/wp-content/uploads/sites/2/2020/03/AR-P3500_3500T_english_Allresist_product_information.pdf" },
  { id: "ar-p-3540", manufacturer: "Allresist", name: "AR-P 3540", tone: "Positive", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1400, referenceRpm: 4000, documentedContrast: 4.5, evidence: "Manufacturer nominal point; direct laser writing demonstrated at 405 nm", sourceUrl: "https://www.allresist.com/wp-content/uploads/sites/2/2020/03/AR-P3500_3500T_english_Allresist_product_information.pdf" },
  { id: "ar-p-5320", manufacturer: "Allresist", name: "AR-P 5320", tone: "Positive lift-off", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 5000, referenceRpm: 4000, documentedContrast: 4, referenceDoseMjCm2: [58, 58], referenceDoseBasis: "E₀, broadband UV stepper at 5.0 µm", evidence: "Manufacturer nominal point", sourceUrl: "https://www.allresist.com/wp-content/uploads/sites/2/2021/02/Allresist_Product-information-Photoresist_AR-P-5300-English-web.pdf" },
  { id: "ar-p-5350", manufacturer: "Allresist", name: "AR-P 5350", tone: "Positive lift-off", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1000, referenceRpm: 4000, documentedContrast: 5, referenceDoseMjCm2: [55, 55], referenceDoseBasis: "E₀, broadband UV stepper at 1.0 µm", evidence: "Manufacturer nominal point", sourceUrl: "https://www.allresist.com/wp-content/uploads/sites/2/2021/02/Allresist_Product-information-Photoresist_AR-P-5300-English-web.pdf" },
  { id: "ar-n-4340", manufacturer: "Allresist", name: "AR-N 4340", tone: "Negative lift-off", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 1400, referenceRpm: 4000, documentedContrast: 5, referenceDoseMjCm2: [140, 140], referenceDoseBasis: "E₀, broadband UV stepper at 1.4 µm; bake-sensitive", evidence: "Manufacturer nominal point", sourceUrl: "https://www.allresist.com/wp-content/uploads/sites/2/2021/02/Allresist_Product-information-Photoresist_AR-N-4300-English-web.pdf" },
  { id: "ar-n-4400-10", manufacturer: "Allresist", name: "AR-N 4400-10", tone: "Negative thick-film", exposureWavelengthsNm: [365, 405, 436], referenceThicknessNm: 10000, referenceRpm: 1000, referenceDoseMjCm2: [26, 26], referenceDoseBasis: "E₀, broadband UV stepper at 10 µm", evidence: "Manufacturer nominal point; direct laser writing demonstrated at 405 nm", sourceUrl: "https://www.allresist.com/wp-content/uploads/sites/2/2021/05/Allresist_Product-information-Photoresist_AR-N-4400-English-web.pdf" },
];

export const PHOTORESIST_MANUFACTURERS_405_NM = [...new Set(PHOTORESISTS_405_NM.map(({ manufacturer }) => manufacturer))].sort();

const PHOTORESIST_IDS_405_NM = new Set(PHOTORESISTS_405_NM.map(({ id }) => id));

export function parsePhotoresistResponseProfiles(input) {
  let profiles;
  try {
    profiles = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    return {};
  }
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) return {};
  return Object.fromEntries(Object.entries(profiles).flatMap(([id, profile]) => {
    if (!PHOTORESIST_IDS_405_NM.has(id) || !profile || typeof profile !== "object") return [];
    const thresholdSeconds = Number(profile.thresholdSeconds);
    const contrast = Number(profile.contrast);
    const opticalBlurMicrometers = Number(profile.opticalBlurMicrometers);
    if (!(thresholdSeconds >= 0.1 && thresholdSeconds <= 600)
      || !(contrast >= 0.2 && contrast <= 20)
      || !(opticalBlurMicrometers >= 0 && opticalBlurMicrometers <= 1000)) return [];
    return [[id, { thresholdSeconds, contrast, opticalBlurMicrometers }]];
  }));
}

export function savePhotoresistResponseProfile(profiles, id, profile) {
  const normalized = parsePhotoresistResponseProfiles({ [id]: profile })[id];
  if (!normalized) throw new Error("The photoresist response calibration is outside the supported range.");
  return { ...parsePhotoresistResponseProfiles(profiles), [id]: normalized };
}
