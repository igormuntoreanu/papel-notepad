//! Quire document core.
//!
//! This crate is the boundary a future native shell should link against.
//! It owns the buffer, undo, encoding, language sniff, syntax spans, and
//! pretty-printers. It does not know about windows, WASM, or the DOM.

mod detect;
mod document;
mod encoding;
mod format;
mod highlight;
mod lang;
mod textutil;

pub use document::{Caret, Document, OutlineItem};
pub use encoding::{Encoding, Eol};
pub use lang::{Lang, LangMode};
