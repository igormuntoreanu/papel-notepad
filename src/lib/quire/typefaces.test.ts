import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CODE_FONTS,
  CODE_STYLES,
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
  it("exposes four faces and five paragraph styles with unique ids", () => {
    assert.equal(FONTS.length, 4);
    assert.equal(TEXT_STYLES.length, 5);
    assert.equal(new Set(FONTS.map((f) => f.id)).size, FONTS.length);
    assert.equal(new Set(TEXT_STYLES.map((s) => s.id)).size, TEXT_STYLES.length);
    assert.deepEqual(
      FONTS.map((f) => f.id),
      ["plex-sans", "inter", "plex-mono", "fira-code"],
    );
    assert.deepEqual(
      TEXT_STYLES.map((s) => s.id),
      ["title", "subtitle", "heading", "subheading", "body"],
    );
  });

  it("keeps the stored codes that old files already use", () => {
    // Retired faces and Section/Subsection keep their old numeric slots so a file
    // written before the trim still opens with a sensible face and size.
    assert.equal(CODE_FONTS[1], "plex-sans");
    assert.equal(CODE_FONTS[2], "plex-mono");
    assert.equal(CODE_FONTS[3], "inter");
    assert.equal(CODE_FONTS[4], "plex-sans"); // Roboto
    assert.equal(CODE_FONTS[9], "plex-mono"); // JetBrains Mono
    assert.equal(CODE_FONTS[10], "fira-code");
    assert.equal(CODE_STYLES[5], "body"); // Section
    assert.equal(CODE_STYLES[6], "body"); // Subsection
  });

  it("keeps only recognised ids when reading a stored document", () => {
    // Unknown values come from newer or hand-edited files; they must never reach CSS.
    assert.deepEqual(readLook({ font: "inter", style: "heading" }), { font: "inter", style: "heading" });
    assert.deepEqual(readLook({ font: "comic-nonsense", style: "body" }), { style: "body" });
    assert.deepEqual(readLook({ font: "inter", style: "gigantic" }), { font: "inter" });
    assert.deepEqual(readLook({ font: "roboto" }), {});
    assert.deepEqual(readLook({ style: "section" }), {});
    assert.deepEqual(readLook({}), {});
    assert.deepEqual(readLook(null), {});
    assert.deepEqual(readLook(undefined), {});
  });

  it("reports defaults and which faces are monospaced", () => {
    assert.equal(fontName(undefined), "IBM Plex Sans");
    assert.equal(styleName(undefined), "Body");
    assert.equal(isMonoFont(undefined), false);
    assert.equal(isMonoFont("plex-mono"), true);
    assert.equal(isMonoFont("fira-code"), true);
    assert.equal(isMonoFont("inter"), false);
    assert.equal(DEFAULT_FONT, "plex-sans");
    assert.equal(DEFAULT_STYLE, "body");
  });

  it("narrows ids", () => {
    assert.equal(isFontId("inter"), true);
    assert.equal(isFontId("Inter"), false);
    assert.equal(isFontId("poppins"), false);
    assert.equal(isStyleId("title"), true);
    assert.equal(isStyleId(""), false);
    assert.equal(isStyleId("section"), false);
  });
});
