const NAMES = ["--noise", "--fibers", "--grain", "--mottle"] as const;

let installed = false;

/**
 * The paper textures are SVG turbulence filters. Chrome re-rasterises those on every
 * repaint of an overlapping area, which makes typing slow, so draw each one once
 * into a canvas and swap the CSS variable for the cached bitmap.
 */
export function installTextures() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  for (const name of NAMES) {
    const value = styles.getPropertyValue(name).trim();
    const match = /^url\((["'])(data:image\/svg\+xml.*)\1\)$/s.exec(value);
    if (!match) continue;
    const src = match[2]!;
    const size = /width='(\d+)'/.exec(decodeURIComponent(src))?.[1];
    const px = Number(size) || 240;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, px, px);
      try {
        root.style.setProperty(name, `url("${canvas.toDataURL("image/png")}")`);
      } catch {
        // Keep the SVG if the canvas cannot be read back.
      }
    };
    img.src = src;
  }
}
