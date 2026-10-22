function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

type Sides = { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean };

/**
 * A stable, irregular clip-path polygon for a torn paper edge. Depth is in px so
 * the tear looks the same on small cards and tall sheets.
 */
export function tornClip(key: string, depth = 5, sides: Sides = { top: true, right: true, bottom: true, left: true }, steps = 26): string {
  const rand = rng(seedOf(key));
  const jag = () => r1(rand() * depth);
  const pts: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = r1((i / steps) * 100);
    pts.push(`${x}% ${sides.top ? jag() : 0}px`);
  }
  for (let i = 1; i < steps; i += 1) {
    const y = r1((i / steps) * 100);
    pts.push(sides.right ? `calc(100% - ${jag()}px) ${y}%` : `100% ${y}%`);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const x = r1((i / steps) * 100);
    pts.push(sides.bottom ? `${x}% calc(100% - ${jag()}px)` : `${x}% 100%`);
  }
  for (let i = steps - 1; i > 0; i -= 1) {
    const y = r1((i / steps) * 100);
    pts.push(`${sides.left ? jag() : 0}px ${y}%`);
  }
  return `polygon(${pts.join(",")})`;
}

/** Small stable tilt in degrees, for cards that look laid by hand. */
export function tiltOf(key: string, max = 0.6): number {
  return r1((rng(seedOf(`${key}:tilt`))() * 2 - 1) * max * 10) / 10;
}
