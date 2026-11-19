//! Quire document core.
//!
//! This crate is the boundary a future native shell should link against.
//! It owns the buffer, undo, encoding, marks, and per-line paragraph properties.
//! It does not know about windows, WASM, or the DOM.

mod document;
mod encoding;
pub mod marks;
mod textutil;

pub use document::{Caret, Cell, Document, OutlineItem};
pub use encoding::{Encoding, Eol};
pub use marks::{Run, Style, StyleChange};

