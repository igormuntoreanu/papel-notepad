import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { urlAt } from "./urls.ts";

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
