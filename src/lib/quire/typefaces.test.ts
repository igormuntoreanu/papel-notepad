import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FONT,
  DEFAULT_STYLE,
  FONTS,
  TEXT_STYLES,
  fontName,
  isFontId,
  isStyleId,
  isMonoFont,
  readLook,
  styleName,
} from "./typefaces.ts";

describe("typefaces", () => {
  it("exposes nine faces and seven paragraph styles with unique ids", () => {
    assert.equal(FONTS.length, 9);
    assert.equal(TEXT_STYLES.length, 7);
    assert.equal(new Set(FONTS.map((f) => f.id)).size, FONTS.length);
    assert.equal(new Set(TEXT_STYLES.map((s) => s.id)).size, TEXT_STYLES.length);
    assert.ok(FONTS.some((f) => f.id === "jetbrains-mono"));
    assert.deepEqual(
      TEXT_STYLES.map((s) => s.id),
      ["title", "subtitle", "heading", "subheading", "section", "subsection", "body"],
    );
  });

  it("keeps only recognised ids when reading a stored document", () => {
    // Unknown values come from newer or hand-edited files; they must never reach CSS.
    assert.deepEqual(readLook({ font: "inter", style: "heading" }), { font: "inter", style: "heading" });
    assert.deepEqual(readLook({ font: "comic-nonsense", style: "body" }), { style: "body" });
    assert.deepEqual(readLook({ font: "inter", style: "gigantic" }), { font: "inter" });
    assert.deepEqual(readLook({}), {});
    assert.deepEqual(readLook(null), {});
    assert.deepEqual(readLook(undefined), {});
  });

  it("reports defaults and which faces are monospaced", () => {
    assert.equal(fontName(undefined), "IBM Plex Sans");
    assert.equal(styleName(undefined), "Body");
    assert.equal(isMonoFont(undefined), false);
    assert.equal(isMonoFont("plex-mono"), true);
    assert.equal(isMonoFont("jetbrains-mono"), true);
    assert.equal(isMonoFont("inter"), false);
    assert.equal(DEFAULT_FONT, "plex-sans");
    assert.equal(DEFAULT_STYLE, "body");
  });

  it("narrows ids", () => {
    assert.equal(isFontId("poppins"), true);
    assert.equal(isFontId("Poppins"), false);
    assert.equal(isStyleId("title"), true);
    assert.equal(isStyleId(""), false);
  });
});
