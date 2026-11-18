import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { urlAt, urlSpans } from "./urls.ts";

describe("urlAt", () => {
  it("finds a URL under the caret", () => {
    const text = "see https://example.com/path for more";
    const start = text.indexOf("https");
    assert.equal(urlAt(text, start), "https://example.com/path");
    assert.equal(urlAt(text, start + 10), "https://example.com/path");
    assert.equal(urlAt(text, 0), null);
  });

  it("strips trailing punctuation", () => {
    const text = "Go https://a.co.";
    assert.equal(urlAt(text, 4), "https://a.co");
  });

  it("accepts caret at the end of the URL", () => {
    const text = "https://z.dev";
    assert.equal(urlAt(text, text.length), "https://z.dev");
  });
});

describe("urlSpans", () => {
  it("finds every URL on its own line, as pasted from a chat", () => {
    const text = "http://localhost:8080/\nhttps://www.youtube.com/watch?v=e5b4lgf2jXE";
    assert.deepEqual(urlSpans(text), [
      { start: 0, end: 22, url: "http://localhost:8080/" },
      { start: 23, end: 66, url: "https://www.youtube.com/watch?v=e5b4lgf2jXE" },
    ]);
  });

  it("stops at the punctuation that ends a sentence, not inside the URL", () => {
    const text = "read https://a.co/x, then (https://b.dev). done";
    assert.deepEqual(
      urlSpans(text).map((s) => text.slice(s.start, s.end)),
      ["https://a.co/x", "https://b.dev"],
    );
  });

  it("ignores prose without scheme and lone scheme words", () => {
    assert.deepEqual(urlSpans("just words, no link"), []);
    assert.deepEqual(urlSpans(""), []);
    assert.deepEqual(urlSpans("http://"), []);
  });

  it("reuses no state between calls (the regex is global)", () => {
    const text = "https://a.co https://b.co";
    assert.equal(urlSpans(text).length, 2);
    assert.equal(urlSpans(text).length, 2);
  });
});
