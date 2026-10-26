import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Papel";

/**
 * Vite's `base`. `/` everywhere except the GitHub Pages build, which is served
 * from `/<repo>/`. Asset hrefs below must go through it, or they 404 off-root.
 */
const BASE = import.meta.env.BASE_URL;

/**
 * The `/__grok/*` manifest and touch icon are served at runtime by the platform
 * PWA plugin, which is not part of a static build. Linking them there would
 * only produce 404s.
 *
 * `BASE` alone cannot answer this: the desktop shells serve the static bundle
 * from the origin root just like a deployed app does (`PAPEL_DESKTOP=1`), so the
 * build flag is what distinguishes "root base because deployed" from "root base
 * because there is no server at all".
 */
const hasPlatformChrome = BASE === "/" && import.meta.env.VITE_DESKTOP !== "1";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#C9A06A" },
      {
        name: "description",
        content: "A paper notepad: torn-paper cards on a kraft desk, fuzzy search, styled text, and a Rust editor core.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: `${BASE}favicon.svg` },
      { rel: "stylesheet", href: appCss },
      ...(hasPlatformChrome
        ? [
            { rel: "manifest", href: "/__grok/manifest.webmanifest" },
            { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
          ]
        : []),
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
