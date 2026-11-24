/**
 * Windows-style snap layouts for the frameless desktop window.
 *
 * Fractions are of the monitor work area (the screen minus the taskbar).
 * Adjacent zones share an edge: the shell rounds each edge once so two
 * halves meet without a gap or an overlap.
 */

export type SnapRect = { x: number; y: number; w: number; h: number };

export type SnapZone = {
  id: string;
  /** Shown on hover. */
  label: string;
  rect: SnapRect;
};

export type SnapLayout = {
  id: string;
  label: string;
  zones: SnapZone[];
};

const half = 0.5;
const third = 1 / 3;
const twoThirds = 2 / 3;

export const SNAP_LAYOUTS: SnapLayout[] = [
  {
    id: "halves",
    label: "Two halves",
    zones: [
      { id: "left", label: "Left half", rect: { x: 0, y: 0, w: half, h: 1 } },
      { id: "right", label: "Right half", rect: { x: half, y: 0, w: half, h: 1 } },
    ],
  },
  {
    id: "left-and-stack",
    label: "Left half, two on the right",
    zones: [
      { id: "left", label: "Left half", rect: { x: 0, y: 0, w: half, h: 1 } },
      { id: "top-right", label: "Top right", rect: { x: half, y: 0, w: half, h: half } },
      { id: "bottom-right", label: "Bottom right", rect: { x: half, y: half, w: half, h: half } },
    ],
  },
  {
    id: "stack-and-right",
    label: "Two on the left, right half",
    zones: [
      { id: "top-left", label: "Top left", rect: { x: 0, y: 0, w: half, h: half } },
      { id: "bottom-left", label: "Bottom left", rect: { x: 0, y: half, w: half, h: half } },
      { id: "right", label: "Right half", rect: { x: half, y: 0, w: half, h: 1 } },
    ],
  },
  {
    id: "thirds",
    label: "Three columns",
    zones: [
      { id: "left", label: "Left third", rect: { x: 0, y: 0, w: third, h: 1 } },
      { id: "middle", label: "Middle third", rect: { x: third, y: 0, w: third, h: 1 } },
      { id: "right", label: "Right third", rect: { x: twoThirds, y: 0, w: third, h: 1 } },
    ],
  },
  {
    id: "wide-left",
    label: "Wide left, narrow right",
    zones: [
      { id: "left", label: "Left two thirds", rect: { x: 0, y: 0, w: twoThirds, h: 1 } },
      { id: "right", label: "Right third", rect: { x: twoThirds, y: 0, w: third, h: 1 } },
    ],
  },
  {
    id: "wide-right",
    label: "Narrow left, wide right",
    zones: [
      { id: "left", label: "Left third", rect: { x: 0, y: 0, w: third, h: 1 } },
      { id: "right", label: "Right two thirds", rect: { x: third, y: 0, w: twoThirds, h: 1 } },
    ],
  },
  {
    id: "quarters",
    label: "Four quarters",
    zones: [
      { id: "top-left", label: "Top left", rect: { x: 0, y: 0, w: half, h: half } },
      { id: "top-right", label: "Top right", rect: { x: half, y: 0, w: half, h: half } },
      { id: "bottom-left", label: "Bottom left", rect: { x: 0, y: half, w: half, h: half } },
      { id: "bottom-right", label: "Bottom right", rect: { x: half, y: half, w: half, h: half } },
    ],
  },
  {
    id: "left-third-stack",
    label: "Left third, two on the right",
    zones: [
      { id: "left", label: "Left third", rect: { x: 0, y: 0, w: third, h: 1 } },
      { id: "top-right", label: "Top right", rect: { x: third, y: 0, w: twoThirds, h: half } },
      { id: "bottom-right", label: "Bottom right", rect: { x: third, y: half, w: twoThirds, h: half } },
    ],
  },
];

/** True when the zones tile the unit square: every sample sits in exactly one zone. */
export function zonesTileUnitSquare(zones: SnapRect[], samples = 48): boolean {
  for (let row = 0; row < samples; row += 1) {
    for (let col = 0; col < samples; col += 1) {
      const px = (col + 0.5) / samples;
      const py = (row + 0.5) / samples;
      let hits = 0;
      for (const zone of zones) {
        const inside =
          px >= zone.x - 1e-9 &&
          py >= zone.y - 1e-9 &&
          px < zone.x + zone.w - 1e-9 &&
          py < zone.y + zone.h - 1e-9;
        if (inside) hits += 1;
      }
      if (hits !== 1) return false;
    }
  }
  return zones.length > 0;
}
