import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { correctionAt } from "./autocorrect.ts";
import { continueBullet, parseDelimited, tableSkeleton, toggleBullets } from "./blocks.ts";
import { distance, searchNotes } from "./fuzzy.ts";
import { FLAG, paint, rangeHas, readMarks } from "./marks.ts";

describe("parseDelimited", () => {
  it("reads Excel cells as a rectangle and pads ragged rows", () => {
    assert.deepEqual(parseDelimited("a\tb\tc\n1\t2\n"), [
      ["a", "b", "c"],
      ["1", "2", ""],
    ]);
  });

  it("reads comma and semicolon CSV, honouring quoted fields", () => {
    assert.deepEqual(parseDelimited('name,note\n"Smith, J",hello\n'), [
      ["name", "note"],
      ["Smith, J", "hello"],
    ]);
    assert.deepEqual(parseDelimited('a;b\n1;2'), [
      ["a", "b"],
      ["1", "2"],
    ]);
    assert.deepEqual(parseDelimited('a\tb\n"say ""hi"""\tz'), [["a", "b"], ['say "hi"', "z"]]);
  });

  it("refuses prose, single rows and one-column text", () => {
    assert.equal(parseDelimited("just one line"), null);
    assert.equal(parseDelimited("hello, world\nthis is prose"), null);
    assert.equal(parseDelimited("a,b\n1,2,3"), null, "mismatched columns are not a grid");
    assert.equal(parseDelimited("   "), null);
  });
});
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

  it("paints a Find hit that stays visible without textarea focus", () => {
    assert.equal(paint("abc", [], [], { start: 1, end: 2 }), 'a<span class="find-hit">b</span>c');
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

describe("save-type", () => {
  it("uses .papel for new sheets and keeps opened extensions", async () => {
    const { defaultSaveExt, isRich, saveExtensions } = await import("./save-type.ts");
    assert.equal(isRich({ hasImage: false, hasMarks: false, hasTable: false }), false);
    assert.equal(defaultSaveExt({}), "papel");
    assert.equal(defaultSaveExt({ sourceExt: "py" }), "py");
    assert.equal(defaultSaveExt({ sourceExt: "txt" }), "txt");
    assert.equal(defaultSaveExt({ sourceExt: "json" }), "json");
    assert.deepEqual(saveExtensions({}), ["papel"]);
    assert.deepEqual(saveExtensions({ sourceExt: "txt" }), ["txt"]);
    assert.deepEqual(saveExtensions({ rich: true, sourceExt: "txt" }), ["txt", "papel"]);
  });
});

describe("backup merge", () => {
  it("skips notes that are already present by id", async () => {
    const { mergeArchive, ARCHIVE_FORMAT } = await import("./backup.ts");
    const archive = {
      format: ARCHIVE_FORMAT,
      version: 1,
      exportedAt: "2026-10-23T00:00:00.000Z",
      order: ["a", "b", "c"],
      notes: [
        { id: "a", title: "A", wrap: true, language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text: "a" }] },
        { id: "b", title: "B", wrap: true, language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text: "b" }] },
        { id: "c", title: "C", wrap: true, language: "auto", eol: "lf", encoding: "utf-8", blocks: [{ kind: "text", text: "c" }] },
      ],
    };
    const result = mergeArchive(archive as never, new Set(["b"]));
    assert.equal(result.imported, 2);
    assert.equal(result.skipped, 1);
    assert.deepEqual(result.notes.map((n) => n.id), ["a", "c"]);
  });
});

describe("ui strings stay valid UTF-8", () => {
  it("has no classic mojibake markers in the shell copy", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.join(import.meta.dirname, "../../components/quire");
    const files = ["quire-app.tsx", "sheet.tsx", "board.tsx", "header-strip.tsx"];
    for (const name of files) {
      const text = await fs.readFile(path.join(root, name), "utf8");
      assert.equal(text.includes("Ã"), false, `${name} contains Ã`);
      assert.equal(text.includes("â€"), false, `${name} contains â€`);
      assert.equal(text.includes("Â·"), false, `${name} contains Â·`);
    }
    // Spot-check the strings that used to garble in the UI. The language chip that
    // carried "Auto · ..." is gone, so the curly quotes and the em dash below are the
    // samples that still ship.
    const app = await fs.readFile(path.join(root, "quire-app.tsx"), "utf8");
    assert.match(app, /“\{applied\}”/);
    assert.match(app, /— Papel/);
    const sheet = await fs.readFile(path.join(root, "sheet.tsx"), "utf8");
    assert.match(sheet, /\d+ × \d+/);
  });
});

describe("zip store", () => {
  it("builds a readable uncompressed archive", async () => {
    const { buildZip, crc32 } = await import("./zip.ts");
    const payload = new TextEncoder().encode('{"ok":true}');
    const zip = buildZip([{ name: "backup.papel-archive", data: payload }]);
    assert.equal(zip[0], 0x50);
    assert.equal(zip[1], 0x4b);
    assert.equal(crc32(payload), crc32(payload));
    assert.ok(zip.length > payload.length + 30);
  });
});

describe("folder file names", () => {
  it("avoids collisions", async () => {
    const { uniqueFileName } = await import("./folder-sync.ts");
    const used = new Set<string>();
    assert.equal(uniqueFileName("Note", "txt", used), "Note.txt");
    assert.equal(uniqueFileName("Note", "txt", used), "Note (2).txt");
  });
});

describe("titles", () => {
  it("adds copy and numbers when needed", async () => {
    const { copyTitle, uniqueTitle, nextUntitled } = await import("./titles.ts");
    assert.equal(copyTitle("nota1", ["nota1"]), "nota1 copy");
    assert.equal(copyTitle("nota1", ["nota1", "nota1 copy"]), "nota1 copy 2");
    assert.equal(uniqueTitle("nota1", ["nota1"]), "nota1 (2)");
    assert.equal(nextUntitled([]), "Untitled");
    assert.equal(nextUntitled(["Untitled"]), "Untitled 2");
  });
});

describe("correctionAt", () => {
  it("fixes a typo once the word ends, keeping the delimiter for undo", () => {
    assert.deepEqual(correctionAt("teh ", 4), { start: 0, end: 4, replacement: "the " });
    assert.equal(correctionAt("teh", 3), null);
  });

  it("keeps capitals and fixes apostrophes", () => {
    assert.deepEqual(correctionAt("Dont.", 5), { start: 0, end: 5, replacement: "Don't." });
    assert.deepEqual(correctionAt("so i ", 5), { start: 3, end: 5, replacement: "I " });
  });

  it("leaves real words, paths and mid-word text alone", () => {
    assert.equal(correctionAt("the ", 4), null);
    assert.equal(correctionAt("src/teh ", 8), null);
    assert.equal(correctionAt("weird ", 6), null);
  });
});
