# Visual QA gallery

Every editor bug fix must leave evidence here. Prefer **PNG screenshots** or short **GIF/WebM**; avoid large MP4 files.

## Layout

```
AI_Documentation/qa/
  README.md
  <version>/           e.g. 0.3.3
    index.md           checklist + links to evidence
    01-….png|gif
    triage-….png       optional: reproduced-but-not-fixed
```

## How to capture

1. Build the desktop UI: `npm run build:desktop`
2. Run the visual harness: `node scripts/qa-visual.mjs`
3. Review files under `AI_Documentation/qa/<version>/`
4. For WebView2-only issues, also drop 1–2 manual screenshots from the portable app into the same folder and link them from `index.md`

## Naming

- `NN-short-slug.png` — numbered scenarios (01, 02, …)
- `triage-short-slug.png` — known issues not fixed in this version
- Keep each file under ~1 MB when possible

## Rule

A PR that changes editor selection, paste, wrap, tables, or toolbar behaviour is incomplete without at least one screenshot or GIF linked from that version’s `index.md`.
