import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports the GDS2GOO application shell", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>GDS2GOO/);
  assert.match(html, /Del layout GDS a la/);
  assert.match(html, /Elegoo Mars 4/);
  assert.match(html, /Generar archivo \.GOO/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
