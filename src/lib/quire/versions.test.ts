import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VERSION_LIMIT, pushVersion } from "./versions.ts";
import type { StoredVersion } from "./persist.ts";

const copy = (at: number, papel = `v${at}`) => ({ at, papel, looks: {} });

describe("version history", () => {
  it("appends versions per sheet without touching other sheets", () => {
    let history: Record<string, StoredVersion[]> = {};
    history = pushVersion(history, "a", copy(1));
    history = pushVersion(history, "a", copy(2));
    history = pushVersion(history, "b", copy(3));
    assert.deepEqual(history.a?.map((c) => c.at), [1, 2]);
    assert.deepEqual(history.b?.map((c) => c.at), [3]);
  });

  it("skips an identical last version", () => {
    const first = pushVersion({}, "a", copy(1));
    const again = pushVersion(first, "a", copy(2, "v1"));
    assert.equal(again, first);
  });

  it("caps the history at the limit, dropping the oldest", () => {
    let history: Record<string, StoredVersion[]> = {};
    for (let i = 0; i < VERSION_LIMIT + 5; i += 1) history = pushVersion(history, "a", copy(i));
    const list = history.a ?? [];
    assert.equal(list.length, VERSION_LIMIT);
    assert.equal(list[0]?.at, 5);
    assert.equal(list[list.length - 1]?.at, VERSION_LIMIT + 4);
  });
});
