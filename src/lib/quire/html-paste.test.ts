import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlHasEmphasis, parseHtmlClipboard } from "./html-paste.ts";

describe("parseHtmlClipboard", () => {
  it("keeps bold and italic ranges from simple tags", () => {
    const { text, runs } = parseHtmlClipboard("<p>Hello <b>bold</b> and <i>italic</i> end</p>");
    assert.equal(text, "Hello bold and italic end");
    assert.deepEqual(
      runs.map((r) => ({ ...r, slice: text.slice(r.start, r.end) })),
      [
        { start: 6, end: 10, bold: true, italic: false, slice: "bold" },
        { start: 15, end: 21, bold: false, italic: true, slice: "italic" },
      ],
    );
  });

  it("reads Word-ish font-weight and font-style spans", () => {
    const html =
      '<p>plain <span style="font-weight:bold">heavy</span> <span style="font-style:italic">slant</span></p>';
    const { text, runs } = parseHtmlClipboard(html);
    assert.equal(text, "plain heavy slant");
    assert.equal(runs.length, 2);
    assert.equal(text.slice(runs[0]!.start, runs[0]!.end), "heavy");
    assert.equal(runs[0]!.bold, true);
    assert.equal(text.slice(runs[1]!.start, runs[1]!.end), "slant");
    assert.equal(runs[1]!.italic, true);
  });

  it("joins paragraphs with newlines", () => {
    const { text } = parseHtmlClipboard("<p>one</p><p>two</p>");
    assert.equal(text, "one\ntwo");
  });

  it("nested strong inside italic stacks both flags", () => {
    const { text, runs } = parseHtmlClipboard("<p><i>a <b>b</b> c</i></p>");
    assert.equal(text, "a b c");
    const mid = runs.find((r) => text.slice(r.start, r.end) === "b");
    assert.ok(mid);
    assert.equal(mid!.bold, true);
    assert.equal(mid!.italic, true);
  });
});

describe("htmlHasEmphasis", () => {
  it("detects emphasis markers", () => {
    assert.equal(htmlHasEmphasis("<b>x</b>"), true);
    assert.equal(htmlHasEmphasis('<span style="font-weight:700">x</span>'), true);
    assert.equal(htmlHasEmphasis("<p>plain</p>"), false);
  });
});
