import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("React owns the application interface from one root", async () => {
  const [html, main] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("src/main.tsx"),
  ]);

  const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? "";
  assert.match(body, /<div id="root"><!--app-html--><\/div>/);
  assert.doesNotMatch(body, /<(?:button|input|select|textarea|nav|header|main|aside|section)\b/i);
  assert.equal((main.match(/document\.getElementById\("root"\)/g) ?? []).length, 1);
  assert.match(main, /hydrateRoot\(root, app\)/);
  assert.match(main, /createRoot\(root\)\.render\(app\)/);
});

test("React and shared components own controls, focus and shortcuts", async () => {
  const app = await readProjectFile("src/App.tsx");

  assert.doesNotMatch(app, /<(?:button|input|select|textarea|details|summary|progress|a)\b/);
  assert.doesNotMatch(app, /document\.(?:getElementById|querySelector|querySelectorAll)\(/);
  assert.doesNotMatch(app, /document\.addEventListener\(["'](?:keydown|wheel|click|input|change)["']/);
  assert.doesNotMatch(app, /window\.dispatchEvent\(/);
  assert.doesNotMatch(app, /\.classList\.|\.setAttribute\(/);
  assert.match(app, /registerItemRef=\{registerWorkflowItemRef\}/);
  assert.match(app, /useScientificShortcut\(closeOverlayShortcut\)/);
  assert.match(app, /onWheel=\{zoomPreview\}/);
  assert.match(app, /<ProgressBar\b/);
  assert.match(app, /<Link\b/);
});

test("scientific processing stays behind the typed worker action API", async () => {
  const [app, workerClient] = await Promise.all([
    readProjectFile("src/App.tsx"),
    readProjectFile("src/workers/maskExportClient.ts"),
  ]);

  assert.match(app, /rasterizeMaskInWorker\(/);
  assert.match(app, /cancelMaskExport/);
  assert.match(workerClient, /export type ExportProgress/);
  assert.match(workerClient, /new Worker\(/);
  assert.match(workerClient, /onProgress\?: \(progress: ExportProgress\)/);
  assert.match(workerClient, /isWorkerMessage\(event\.data\)/);
  assert.match(workerClient, /addEventListener\('messageerror'/);
});
