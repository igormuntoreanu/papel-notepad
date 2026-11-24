import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SNAP_LAYOUTS, zonesTileUnitSquare } from "./snap-layouts.ts";

describe("snap layouts", () => {
  it("offers the Windows arrangements and each one tiles the screen", () => {
    assert.ok(SNAP_LAYOUTS.length >= 6);
    const ids = new Set<string>();
    for (const layout of SNAP_LAYOUTS) {
      assert.equal(ids.has(layout.id), false, layout.id);
      ids.add(layout.id);
      assert.ok(layout.zones.length >= 2, layout.id);
      assert.equal(
        zonesTileUnitSquare(layout.zones.map((zone) => zone.rect)),
        true,
        `${layout.id} leaves a gap or an overlap`,
      );
      for (const zone of layout.zones) {
        assert.ok(zone.label.length > 0);
        assert.ok(zone.rect.w > 0 && zone.rect.h > 0);
      }
    }
  });
});
