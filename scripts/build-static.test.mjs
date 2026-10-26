/**
 * The static-build contract: which flags each host gets, and where its bundle
 * lands. The desktop shells ship exactly the `dist/client` output, so these
 * flags are the only thing keeping V1/V2 from drifting off the Pages build.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { needsCopy, outputDirFor, staticFlags } from "./build-static.mjs";

test("desktop static mode uses the origin root and disables auth", () => {
  assert.deepEqual(staticFlags("desktop"), {
    PAPEL_DESKTOP: "1",
    VITE_DESKTOP: "1",
    VITE_AUTH_ENABLED: "false",
  });
});

test("pages mode keeps the project-site base", () => {
  assert.deepEqual(staticFlags("pages"), {
    PAPEL_PAGES: "1",
    PAPEL_PAGES_BASE: "/papel-notepad/",
  });
});

test("desktop publishes from its own directory so Vercel output is untouched", () => {
  assert.equal(outputDirFor("desktop"), "dist-desktop/client");
  assert.equal(outputDirFor("pages"), "dist/client");
  assert.equal(needsCopy("desktop"), true);
  assert.equal(needsCopy("pages"), false);
});

test("an unknown mode has no flags and no output", () => {
  assert.equal(staticFlags("msi"), null);
  assert.equal(outputDirFor("msi"), null);
});
