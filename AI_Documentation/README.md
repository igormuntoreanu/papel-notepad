# Papel — AI Documentation

Handover pack for people and AI agents picking up Papel.

| File | Read it for |
| --- | --- |
| [BUSINESS.md](./BUSINESS.md) | What Papel is, who it is for, scope, features, requirements, open questions. |
| [TECHNICAL.md](./TECHNICAL.md) | Architecture, stack, data flow, file formats, setup, design decisions, known issues. |
| [FIXED-BUGS.md](./FIXED-BUGS.md) | Bugs already fixed, and the test that must still pass for each one. |

## Quick facts

- **Product**: Papel, a light notepad that looks like paper. English UI.
- **Platform today**: web browser only. A native app is planned ("browser now, native later"); no native shell exists yet.
- **Former name**: Quire. Code identifiers (`QuireApp`, `quire-core`, `quire-wasm`, `src/lib/quire`) still use the old name. `.quire` files still open.
- **Repository**: `github.com/igormuntoreanu/papel-notepad` (public).
- **State as of 2026-10-22**: redesign delivered on branch `redesign-board`, PR #1, not yet merged.

## Rules for an AI continuing this work

1. Treat [TECHNICAL.md](./TECHNICAL.md) as the map; verify against code before changing anything.
2. Visual changes live in `src/styles.css` and `src/components/quire/*`. The Rust core and the `.papel` format should only change with a version bump and a migration path.
3. `src/lib/auth`, `src/lib/app-data` and most of `scripts/` are workspace scaffolding. The notepad does not depend on them.
4. Keep typing fast. Measure per-keystroke frame time in a production build after any change to the sheet, cards, or textures (see TECHNICAL.md §8).
5. Do not reintroduce night mode unless asked; it was removed on purpose.
6. Items in the "Gaps" sections are not decisions. Ask the owner.
7. Before shipping, re-run every guard in [FIXED-BUGS.md](./FIXED-BUGS.md). Add an entry when a bug is fixed.
