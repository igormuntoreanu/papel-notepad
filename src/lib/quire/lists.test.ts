import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_LEVEL,
  applyListStyle,
  continueList,
  indentList,
  listMarker,
  parseListItem,
  renumberLists,
} from "./lists.ts";

describe("lists", () => {
  it("parses the four marker styles and their nesting", () => {
    assert.deepEqual(parseListItem("1. one")?.item, { kind: "dot", level: 1, path: [1], text: "one" });
    assert.deepEqual(parseListItem("  1.2. nested")?.item, {
      kind: "dot",
      level: 2,
      path: [1, 2],
      text: "nested",
    });
    assert.deepEqual(parseListItem("    1.1.1. deep")?.item, {
      kind: "dot",
      level: 3,
      path: [1, 1, 1],
      text: "deep",
    });
    assert.deepEqual(parseListItem("2) paren")?.item, { kind: "paren", level: 1, path: [2], text: "paren" });
    assert.deepEqual(parseListItem("a. letter")?.item, { kind: "letter", level: 1, path: [], letter: "a", text: "letter" });
    assert.equal(parseListItem("• bullet")?.item.kind, "bullet");
    assert.equal(parseListItem("plain text"), null);
    assert.equal(parseListItem("1.5 kilometres"), null, "a decimal is not a list item");
  });

  it("renders markers for each style and level", () => {
    assert.equal(listMarker("bullet", 1, []), "• ");
    assert.equal(listMarker("bullet", 2, []), "◦ ");
    assert.equal(listMarker("dot", 2, [1, 2]), "1.2. ");
    assert.equal(listMarker("paren", 3, [1, 2, 3]), "1.2.3) ");
    assert.equal(listMarker("letter", 1, [], "b"), "b. ");
    assert.equal(listMarker("letter", 2, [1], "b"), "b.1. ");
  });

  it("renumbers siblings and nested paths", () => {
    assert.deepEqual(renumberLists(["1. one", "   1.1. a", "   7.9. b", "1.5. two"]), [
      "1. one",
      "   1.1. a",
      "   1.2. b",
      "2. two",
    ]);
  });

  it("letters run a, b, c and nest under their parent", () => {
    assert.deepEqual(renumberLists(["x. a", "x. b"]), ["a. a", "b. b"]);
    assert.deepEqual(renumberLists(["z. one", "  c.3. kid"]), ["a. one", "  a.1. kid"]);
  });

  it("adds markers to plain lines and removes them when all already have that style", () => {
    const added = applyListStyle("one\ntwo", 0, 6, "dot");
    assert.equal(added.insert, "1. one\n2. two");
    assert.equal(added.removed, false);

    const text = "1. one\n2. two";
    const removed = applyListStyle(text, 0, text.length, "dot");
    assert.equal(removed.insert, "one\ntwo");
    assert.equal(removed.removed, true);

    // A different style replaces the marker instead of stacking one.
    assert.equal(applyListStyle(text, 0, text.length, "paren").insert, "1) one\n2) two");
    assert.equal(applyListStyle("• a\n• b", 0, 9, "dot").insert, "1. a\n2. b");
  });

  it("continues a list on Enter and ends it on an empty item", () => {
    assert.equal(continueList("1. one", 6)?.insert, "\n2. ");
    assert.equal(continueList("  1.1. kid", 10)?.insert, "\n  1.2. ");
    assert.equal(continueList("• item", 6)?.insert, "\n• ");
    assert.equal(continueList("3) paren", 8)?.insert, "\n4) ");
    assert.equal(continueList("1. ", 3)?.insert, "", "empty item ends the list");
    assert.equal(continueList("no list", 7), null);
  });

  it("indents and outdents list lines, renumbering the block", () => {
    const text = "1. one\n2. two";
    const indented = indentList(text, 7, 7, 1);
    assert.equal(indented?.insert, "1. one\n  1.1. two");
    const outdented = indentList(indented!.insert, 9, 9, -1);
    assert.equal(outdented?.insert, "1. one\n2. two");
    assert.equal(indentList("plain", 0, 0, 1), null);
  });

  it("stops nesting at three levels", () => {
    const deep = `${"  ".repeat(MAX_LEVEL - 1)}1. one`;
    assert.equal(indentList(deep, deep.length, deep.length, 1)?.insert, deep);
  });
});
