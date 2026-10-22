import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { correctionAt } from "./autocorrect.ts";
import { continueBullet, tableSkeleton, toggleBullets } from "./blocks.ts";
import { distance, searchNotes } from "./fuzzy.ts";
import { FLAG, paint, rangeHas, readMarks } from "./marks.ts";

describe("tableSkeleton", () => {
  it("draws a box with one row per requested row", () => {
    const lines = tableSkeleton(3, 3).split("\n");
    assert.equal(lines.length, 7, "top rule, then a row and a rule three times");
    assert.equal(lines[0], "+---------+---------+---------+");
    assert.equal(lines[1], "|         |         |         |");
    assert.equal(lines[6], lines[0], "the last rule closes the box");
    for (const line of lines) assert.equal(line.length, lines[0]!.length, "every line is the same width");
  });

  it("clamps to something drawable", () => {
    assert.equal(tableSkeleton(0, 0).split("\n").length, 3);
    assert.equal(tableSkeleton(999, 999).split("\n").length, 41);
  });
});

describe("toggleBullets", () => {
  it("marks every selected line", () => {
    assert.deepEqual(toggleBullets("a\nb", 0, 3), { start: 0, end: 3, insert: "• a\n• b", allBulleted: false });
  });

  it("removes the marks when they are all already there", () => {
    assert.deepEqual(toggleBullets("• a\n• b", 0, 7), { start: 0, end: 7, insert: "a\nb", allBulleted: true });
  });

  it("only touches the lines the selection covers", () => {
    const change = toggleBullets("one\ntwo\nthree", 4, 7);
    assert.equal(change.start, 4);
    assert.equal(change.insert, "• two");
  });

  it("leaves blank lines alone inside a selection", () => {
    assert.equal(toggleBullets("a\n\nb", 0, 4).insert, "• a\n\n• b");
  });

  it("starts a list from an empty line", () => {
    assert.equal(toggleBullets("", 0, 0).insert, "• ");
  });
});

describe("continueBullet", () => {
  it("carries the bullet to the next line", () => {
    assert.deepEqual(continueBullet("• hello", 7), { start: 7, end: 7, insert: "\n• " });
  });

  it("keeps the indent", () => {
    assert.equal(continueBullet("  • hello", 9)?.insert, "\n  • ");
  });

  it("ends the list when the bullet is empty", () => {
    assert.deepEqual(continueBullet("• ", 2), { start: 0, end: 2, insert: "" });
  });

  it("ignores lines that are not bullets", () => {
    assert.equal(continueBullet("hello", 5), null);
    assert.equal(continueBullet("• a\nhello", 9), null);
  });
});

describe("paint", () => {
  it("escapes markup in plain text", () => {
    assert.equal(paint("<b>&</b>", []), "&lt;b&gt;&amp;&lt;/b&gt;");
  });

  it("layers syntax spans and style marks", () => {
    // "let x" with a keyword span on "let" and bold+ink on "et x".
    const html = paint("let x", [0, 3, 1], readMarks([1, 5, FLAG.bold, 1, 0]));
    assert.equal(html, '<span class="k">l</span><span class="k sb ink1">et</span><span class="sb ink1"> x</span>');
  });

  it("emits highlighter classes", () => {
    assert.equal(paint("ab", [], readMarks([0, 1, 0, 0, 2])), '<span class="hl2">a</span>b');
  });
});

describe("rangeHas", () => {
  const marks = readMarks([0, 3, FLAG.bold, 0, 0, 3, 6, FLAG.bold | FLAG.italic, 0, 0]);
  it("spans touching runs", () => {
    assert.equal(rangeHas(marks, 1, 5, FLAG.bold), true);
    assert.equal(rangeHas(marks, 1, 5, FLAG.italic), false);
    assert.equal(rangeHas(marks, 4, 6, FLAG.italic), true);
    assert.equal(rangeHas(marks, 5, 8, FLAG.bold), false);
  });
});

describe("searchNotes", () => {
  const docs = [
    { id: "a", title: "Letter to Ana", text: "The garden is doing well." },
    { id: "b", title: "Groceries", text: "Milk, eggs, bread." },
    { id: "c", title: "main.rs", text: "fn main() {}" },
  ];

  it("matches substrings in titles first", () => {
    assert.deepEqual(searchNotes("groc", docs).map((h) => h.id), ["b"]);
  });

  it("tolerates a typo and returns a snippet", () => {
    const hits = searchNotes("gardn", docs);
    assert.deepEqual(hits.map((h) => h.id), ["a"]);
    assert.match(hits[0]!.snippet, /garden/);
  });

  it("requires every word to match", () => {
    assert.deepEqual(searchNotes("milk garden", docs), []);
  });

  it("bounds the edit distance", () => {
    assert.equal(distance("kitten", "sitting", 3), 3);
    assert.equal(distance("abc", "xyzxyz", 1), 2);
  });
});

describe("correctionAt", () => {
  it("fixes a typo once the word ends", () => {
    assert.deepEqual(correctionAt("teh ", 4), { start: 0, end: 3, replacement: "the" });
    assert.equal(correctionAt("teh", 3), null);
  });

  it("keeps capitals and fixes apostrophes", () => {
    assert.deepEqual(correctionAt("Dont.", 5), { start: 0, end: 4, replacement: "Don't" });
    assert.deepEqual(correctionAt("so i ", 5), { start: 3, end: 4, replacement: "I" });
  });

  it("leaves real words, paths and mid-word text alone", () => {
    assert.equal(correctionAt("the ", 4), null);
    assert.equal(correctionAt("src/teh ", 8), null);
    assert.equal(correctionAt("weird ", 6), null);
  });
});
