import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CARBON_LIMIT, pushCarbon } from "./carbon.ts";
import type { StoredCarbonCopy } from "./persist.ts";

const copy = (at: number, papel = `v${at}`) => ({ at, papel, looks: {} });

describe("carbon copies", () => {
  it("appends versions per sheet without touching other sheets", () => {
    let carbon: Record<string, StoredCarbonCopy[]> = {};
    carbon = pushCarbon(carbon, "a", copy(1));
    carbon = pushCarbon(carbon, "a", copy(2));
    carbon = pushCarbon(carbon, "b", copy(3));
    assert.deepEqual(carbon.a?.map((c) => c.at), [1, 2]);
    assert.deepEqual(carbon.b?.map((c) => c.at), [3]);
  });

  it("skips an identical last version", () => {
    const first = pushCarbon({}, "a", copy(1));
    const again = pushCarbon(first, "a", copy(2, "v1"));
    assert.equal(again, first);
  });

  it("caps the history at the limit, dropping the oldest", () => {
    let carbon: Record<string, StoredCarbonCopy[]> = {};
    for (let i = 0; i < CARBON_LIMIT + 5; i += 1) carbon = pushCarbon(carbon, "a", copy(i));
    const list = carbon.a ?? [];
    assert.equal(list.length, CARBON_LIMIT);
    assert.equal(list[0]?.at, 5);
    assert.equal(list[list.length - 1]?.at, CARBON_LIMIT + 4);
  });
});
