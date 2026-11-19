import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";

/**
 * Static builds (opt-in): the same prerendered output for two different hosts.
 *
 * Pages cannot run the Nitro server, so this mode prerenders the routes and
 * drops the Nitro plugin, leaving plain `index.html` + hashed assets. `base`
 * must match the Pages URL path, because GitHub serves project sites from
 * `/<repo>/` and every emitted asset URL is rebased onto it.
 *
 * The desktop shells (Tauri, Electron) serve the identical output from an
 * application-owned scheme at the origin root, so `PAPEL_DESKTOP=1` takes the
 * same static path with `base: "/"`. Reusing one build means the portable
 * builds cannot drift from the web app: same files, same router, same CSS.
 *
 * Unset by default: `npm run dev`, `vite preview` and the Vercel build follow
 * the original path unchanged.
 */
const pagesMode = process.env.PAPEL_PAGES === "1";
const pagesBase = process.env.PAPEL_PAGES_BASE ?? "/papel-notepad/";
// Pages wins if both are set: it is the deployment that needs a subpath base.
const desktopMode = !pagesMode && process.env.PAPEL_DESKTOP === "1";
/** Either static mode: prerender, no Nitro, no runtime PWA middleware. */
const staticMode = pagesMode || desktopMode;
const staticBase = pagesMode ? pagesBase : desktopMode ? "/" : undefined;

// `0.0.0.0:8080` is the live-preview contract — don't change host/port.
// The dev server starts once `src/router.tsx` and `src/routes/` exist — see
// AGENTS.md § "First scaffold".
export default defineConfig(({ command, isPreview }) => ({
  base: staticBase,
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    // PWA head + ?install=1 tutorial page; runs before Start/Nitro. Skipped on
    // static builds: it is a runtime-server feature and would inject /__grok
    // links that nothing serves there.
    ...(staticMode ? [] : [grokPwaPlugin()]),
    tailwindcss(),
    tanstackStart(
      staticMode
        ? {
            // Static prerendering, not `spa`: the SPA shell is an empty
            // document, which makes React hydrate `<Boot/>` against nothing
            // (error #418) and shows a blank page until JS lands. Prerendering
            // `/` writes the real boot markup into index.html instead.
            prerender: { enabled: true },
          }
        : undefined,
    ),
    ...(!staticMode && (command === "build" || isPreview)
      ? [
          nitro({
            preset: "vercel",
            // Auto-registers server/middleware/* (the PWA install page +
            // manifest + head-tag middleware). Nitro v3 defaults serverDir to
            // false, so removing this silently unwires /?install=1 on deploys.
            serverDir: "./server",
          }),
        ]
      : []),
    viteReact(),
  ],
}));
