import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TABS, isTabId, tabColor, tabName } from "./tabs.ts";

describe("card tabs", () => {
  it("exposes stable ids with unique colours", () => {
    assert.deepEqual(
      TABS.map((tab) => tab.id),
      ["red", "amber", "blue", "green", "violet"],
    );
    assert.equal(new Set(TABS.map((tab) => tab.color)).size, TABS.length);
  });

  it("narrows stored ids and looks up colours", () => {
    assert.equal(isTabId("blue"), true);
    assert.equal(isTabId("Blue"), false);
    assert.equal(isTabId("chartreuse"), false);
    assert.equal(tabColor("red"), "#9c3b2e");
    assert.equal(tabName("violet"), "Violet");
    assert.equal(tabColor(undefined), undefined);
  });
});
