import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { correctionAt } from "./autocorrect.ts";
import { distance, searchNotes } from "./fuzzy.ts";
import { FLAG, paint, rangeHas, readMarks } from "./marks.ts";

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
