import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { copyTitle, nextUntitled, titleFromFirstLine, titleFromFilename, uniqueTitle } from "./titles.ts";

describe("titles", () => {
  it("takes the title from the first non-empty line", () => {
    assert.equal(titleFromFirstLine("Dear Ana,\nHow are you?"), "Dear Ana,");
    assert.equal(titleFromFirstLine("\n\n  Grocery list  \nMilk"), "Grocery list");
    assert.equal(titleFromFirstLine("  a   b\tc  "), "a b c");
    assert.equal(titleFromFirstLine(""), "");
    assert.equal(titleFromFirstLine("   \n\t\n"), "");
  });

  it("caps a long first line without leaving trailing space", () => {
    const title = titleFromFirstLine("word ".repeat(30));
    assert.ok(title.length <= 60);
    assert.equal(title.endsWith(" "), false);
  });

  it("keeps the numbered fallback for a sheet with no text", () => {
    assert.equal(nextUntitled([]), "Untitled");
    assert.equal(nextUntitled(["Untitled"]), "Untitled 2");
    assert.equal(uniqueTitle("", ["Untitled"]), "Untitled (2)");
  });

  it("still derives copy and filename titles", () => {
    assert.equal(copyTitle("Note", ["Note"]), "Note copy");
    assert.equal(titleFromFilename("C:/notes/plan.papel"), "plan");
  });
});
