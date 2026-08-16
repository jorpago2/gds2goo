const MAX_RECIPES = 20;

export function parseRecipeLibrary(input) {
  if (!input) return [];
  let recipes;
  try {
    recipes = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    return [];
  }
  if (!Array.isArray(recipes)) return [];
  return recipes.flatMap((recipe) => {
    if (!recipe || typeof recipe.name !== "string" || !recipe.name.trim() || recipe.name.length > 50
      || !Number.isFinite(recipe.exposure) || recipe.exposure < 0.1 || recipe.exposure > 600
      || !recipe.process || typeof recipe.process !== "object") return [];
    const text = (value) => typeof value === "string" ? value : "";
    return [{
      name: recipe.name.trim(),
      exposure: recipe.exposure,
      calibrationSeries: text(recipe.calibrationSeries),
      process: {
        photoresist: text(recipe.process.photoresist),
        thicknessNm: text(recipe.process.thicknessNm),
        softBake: text(recipe.process.softBake),
        development: text(recipe.process.development),
        notes: text(recipe.process.notes),
      },
    }];
  }).slice(0, MAX_RECIPES);
}

export function saveRecipeToLibrary(recipes, recipe) {
  const normalized = parseRecipeLibrary([recipe]);
  if (!normalized.length) throw new Error("Recipe name and exposure are invalid.");
  return [normalized[0], ...parseRecipeLibrary(recipes).filter(({ name }) => name !== normalized[0].name)].slice(0, MAX_RECIPES);
}
