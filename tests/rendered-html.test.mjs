import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exports the GDS2GOO application shell", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>GDS2GOO/);
  assert.match(html, /From GDS layout to the/);
  assert.match(html, /Elegoo Mars 4/);
  assert.match(html, /Generate \.GOO file/);
  assert.match(html, /ZOOM/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
