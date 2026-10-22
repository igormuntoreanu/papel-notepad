# Papel — Business Documentation

## Table of Contents

1. [Project Overview & Purpose](#1-project-overview--purpose)
2. [Target Audience & Users](#2-target-audience--users)
3. [Business Goals & Success Metrics](#3-business-goals--success-metrics)
4. [Scope](#4-scope)
5. [Key Features & Value Proposition](#5-key-features--value-proposition)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Assumptions, Constraints, and Open Questions](#8-assumptions-constraints-and-open-questions)
9. [Summary of Gaps / Questions](#9-summary-of-gaps--questions)

---

## 1. Project Overview & Purpose

Papel is a light notepad that looks and feels like paper. It runs in a web browser today. A native version is planned for later.

It is a Notepad-style editor for quick notes and small code snippets:

- Notes appear as torn paper cards on a kraft-cardboard desk (the **board**).
- Opening a card turns it into a large sheet for writing (the **focus** view).
- Code gets syntax color and one-click Autoformat. Plain prose is left alone.
- Text can be styled (bold, italic, underline, strikethrough, ink colors, highlighters).
- Screenshots and images can be pasted onto a sheet.
- Work is autosaved in the browser and recovered after a reload.

**Problem it solves (as stated by the owner):** a fast notepad for small notes, with the comfort of paper, that also handles code without getting in the way.

**History:** the product was called Quire. It is now Papel. `.quire` files still open.

## 2. Target Audience & Users

> **Assumption.** The owner has not defined personas. The list below is inferred from the feature set and must be confirmed.

| Persona (assumed) | Why they would use Papel |
| --- | --- |
| Quick note-taker | Wants a fast, pleasant place for lists, letters and drafts without accounts or setup. |
| Developer / consultant | Pastes JSON, SQL, XML, code snippets, including ABAP; wants color and Autoformat without opening an IDE. |
| Screenshot collector | Pastes screenshots next to notes and keeps them together in one sheet. |

The UI is in English. The autocorrect works for English only.

## 3. Business Goals & Success Metrics

> **Gap.** No business goals, KPIs or success metrics have been provided.

Known product intentions (from the owner's brief):

- Feel like paper; the "Paper" skin (torn cream notebook, ruled lines) is the reference look.
- Fast keystrokes for small notes.
- Never lose work (autosave and recovery).
- Browser first, native later.

Candidate metrics (proposals only, not agreed): typing latency per keystroke, sessions per week, notes created per session, share of notes saved to a file, recovery success after reload.

## 4. Scope

### In scope (implemented)

- Browser notepad with board and focus views; phone layout.
- Multiple open notes ("sheets"), reorderable.
- Typo-tolerant search across all notes, language filter, sort.
- Plain text editing with undo/redo (200 steps).
- Syntax color and Autoformat for: JSON, XML, HTML, CSS, JavaScript/TypeScript, SQL, Markdown, Rust, Java, C, C++, Python, ABAP. Detection is conservative so ordinary prose is not treated as code.
- Inline styles: bold, italic, underline, strikethrough, 5 ink colors, 4 highlighters.
- English autocorrect of common typos on prose sheets.
- Pasting and inserting images (up to about 12 MB each).
- Find, replace, go to line; insert date/time; word wrap; zoom.
- Three paper skins: Paper, Ink, Carbon.
- Autosave to the browser and recovery on reload.
- Open `.txt` and code files, `.papel`, `.quire`; save `.txt` or `.papel`.
- Encoding (UTF-8, UTF-8 BOM, UTF-16 LE, Windows-1252) and line ending (LF, CRLF) control.

### Out of scope (now)

- **Native app**: planned, not started.
- **Night / dark mode**: removed on purpose; "only day for now".
- **Accounts, sign-in, cloud sync, sharing, collaboration**: not part of the notepad. Auth code exists in the repository as unused workspace scaffolding.
- **Rich formatting beyond inline styles** (headings, lists, tables, fonts, sizes per word).
- **Spell-check suggestions UI** and non-English autocorrect.
- **Logo lockup**: the brand mark is the word "Papel"; no logo yet.

## 5. Key Features & Value Proposition

| Feature | User value |
| --- | --- |
| Paper look (torn cards, kraft desk, three skins) | A calm, tactile place to write; less "software", more desk. |
| Board of cards | See all notes at a glance: preview, language, word count, last edit, unsaved marker, image thumbnail. |
| Focus sheet + side cards | Write with room, jump between notes without losing context. |
| Typo-tolerant search | Find a note even when the word is misspelled. |
| Code awareness | Color and Autoformat for 13 languages, without turning letters into code. |
| Text styles and highlighters | Mark what matters, like a pen and highlighter on paper. |
| Paste screenshots | Keep images with the words they belong to. |
| Autocorrect | Fewer typos in quick notes; one undo to revert. |
| Autosave and recovery | Work survives a reload or a closed tab on the same device. |
| Open file formats | `.txt` stays plain text; `.papel` is documented JSON. |

## 6. Functional Requirements

User stories describe current behavior.

**Notes and board**

1. As a user, I see all my notes as cards on a board when the app opens.
2. As a user, I create a new note with one click or Ctrl+N, and the caret is ready to type.
3. As a user, I open a note by clicking its card; other notes stay visible in a side column.
4. As a user, I rename, save, move, or close a note from its card menu.
5. As a user, I reorder notes by dragging cards (in "My order" sort).
6. As a user, I am warned before closing a note with unsaved edits.

**Search and filter**

7. As a user, I type at least 3 letters to filter notes, or press Go for shorter terms; small typos still match.
8. As a user, I filter notes by language and sort by my order, last edited, or title.

**Writing**

9. As a user, I type, undo and redo quickly; history keeps 200 steps.
10. As a user, I select text and apply bold, italic, underline, strikethrough, an ink color, or a highlighter.
11. As a user, common English typos are fixed when I finish a word; Ctrl+Z reverts the fix. I can turn this off.
12. As a user, I paste a screenshot and it appears where my caret was.
13. As a user, I find, replace, and go to a line inside the open note (Ctrl+F).
14. As a user, code in my note is colored, and Autoformat tidies it; prose is left unchanged.

**Files and safety**

15. As a user, a note without images or styles saves as `.txt` with my chosen encoding and line ending.
16. As a user, a note with images or styles saves as `.papel`; I can also save "text only" after a warning.
17. As a user, I open `.txt`, code files, `.papel` and old `.quire` files, by picker or drag-and-drop.
18. As a user, my notes and settings are autosaved in this browser and restored after reload.

## 7. Non-Functional Requirements

| Area | Requirement | Status |
| --- | --- | --- |
| Responsiveness | Typing must feel instant. | Measured about 18 ms per keystroke in a production build on the test machine (one frame ≈ 17 ms). No formal target agreed. |
| Data safety | No silent loss of edits. | Autosave about 400 ms after changes; leave-page warning when unsaved; discard confirmation. |
| Privacy | Notes stay on the device. | Notes are stored only in the browser's IndexedDB; the notepad sends no note content to a server. |
| Usability | Works with mouse, keyboard and touch. | Keyboard shortcuts; 44 px touch targets on phone; phone layout. |
| Accessibility | Usable with assistive tech. | Buttons and regions are labelled; formal audit **not done**. |
| Language | English UI. | Implemented. |
| Compatibility | Modern browsers. | Tested in a Chromium-based browser only. Other browsers **not verified**. |
| Limits | Images ≤ about 12 MB; undo 200 steps; zoom 12–28 px. | Implemented. |

## 8. Assumptions, Constraints, and Open Questions

**Assumptions**

- Personas in §2 are inferred.
- Single user per browser profile; no multi-device expectations today.
- Users are fine with notes living only in this browser until they save to a file.

**Constraints**

- Browser storage can be cleared by the user or the browser; autosave is not a backup.
- Inline styles require the monospace editor font (style alignment depends on equal character widths).
- `.txt` cannot hold images or styles; those need `.papel`.

**Open questions**

- See §9.

## 9. Summary of Gaps / Questions

1. **Business goals and KPIs**: what does success look like (users, retention, revenue, internal use)?
2. **Target users**: confirm or replace the assumed personas.
3. **Monetization / distribution**: free, paid, internal tool? Where is it published?
4. **Native roadmap**: which platforms (Windows, macOS, mobile), and when?
5. **Night mode**: when, if ever, does it come back?
6. **Sync and backup**: is cloud storage or export of all notes wanted?
7. **Browser support**: which browsers and versions must be supported?
8. **Accessibility target**: is a standard (for example WCAG 2.2 AA) required?
9. **Autocorrect**: other languages? user-defined replacements?
10. **Branding**: logo, final favicon (currently a cream sheet on walnut while the desk is kraft).
