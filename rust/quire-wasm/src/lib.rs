use quire_core::marks::unflatten;
use quire_core::{Cell, Caret as CoreCaret, Document, Encoding, Eol, LangMode, StyleChange};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Caret {
    pub block_id: u32,
    pub start: u32,
    pub end: u32,
}

impl From<CoreCaret> for Caret {
    fn from(c: CoreCaret) -> Self {
        Self { block_id: c.block_id, start: c.start, end: c.end }
    }
}

#[wasm_bindgen]
pub struct Session {
    doc: Document,
}

#[wasm_bindgen]
impl Session {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Session {
        Session { doc: Document::new() }
    }

    pub fn open_bytes(&mut self, bytes: &[u8]) -> String {
        self.doc.open_bytes(bytes);
        format!(
            "{{\"encoding\":\"{}\",\"eol\":\"{}\",\"block\":{}}}",
            self.doc.encoding().as_str(),
            self.doc.eol().as_str(),
            self.doc.first_text_id()
        )
    }

    pub fn restore_begin(&mut self) {
        self.doc.restore_begin();
    }

    pub fn restore_text(&mut self, text: &str) -> u32 {
        self.doc.restore_text(text)
    }

    pub fn restore_image(&mut self, mime: &str, bytes: &[u8]) -> u32 {
        self.doc.restore_image(mime, bytes.to_vec())
    }

    pub fn restore_end(&mut self, language: &str, eol: &str, encoding: &str) {
        self.doc.restore_end(language, eol, encoding);
    }

    pub fn restore_marks(&mut self, id: u32, flat: &[u32]) {
        self.doc.restore_marks(id, flat);
    }

    /// Flat `[start, end, flags, ink, hl]*` style runs for a text block.
    pub fn marks(&self, id: u32) -> Vec<u32> {
        quire_core::marks::flatten(&self.doc.marks_of(id))
    }

    pub fn has_marks(&self) -> bool {
        self.doc.has_marks()
    }

    /// `kind`: bold | italic | underline | strike (value 0/1), ink | hl (palette index, 0 = none), clear.
    pub fn apply_style(&mut self, id: u32, start: u32, end: u32, kind: &str, value: u32) -> bool {
        let Some(change) = StyleChange::parse(kind, value) else { return false };
        self.doc.apply_style(id, start, end, change)
    }

    pub fn edit(&mut self, id: u32, start: u32, end: u32, text: &str, coalesce: bool) {
        self.doc.edit(id, start, end, text, coalesce);
    }

    pub fn insert_image(&mut self, id: u32, at: u32, mime: &str, bytes: &[u8]) -> u32 {
        self.doc
            .insert_image(id, at, mime, bytes.to_vec())
            .map(|c| c.block_id)
            .unwrap_or(0)
    }

    /// Caret that should focus the text after the new image. `block_id` 0 means the insert was refused.
    pub fn insert_image_caret(&mut self, id: u32, at: u32, mime: &str, bytes: &[u8]) -> Option<Caret> {
        self.doc.insert_image(id, at, mime, bytes.to_vec()).map(Caret::from)
    }

    pub fn delete_image(&mut self, image_id: u32) -> Option<Caret> {
        self.doc.delete_image(image_id).map(Caret::from)
    }

    pub fn undo(&mut self) -> Option<Caret> {
        self.doc.undo().map(Caret::from)
    }

    pub fn redo(&mut self) -> Option<Caret> {
        self.doc.redo().map(Caret::from)
    }

    pub fn can_undo(&self) -> bool {
        self.doc.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.doc.can_redo()
    }

    pub fn is_dirty(&self) -> bool {
        self.doc.is_dirty()
    }

    pub fn mark_clean(&mut self) {
        self.doc.mark_clean();
    }

    pub fn outline(&self) -> String {
        self.doc.outline_json()
    }

    pub fn text_of(&self, id: u32) -> String {
        self.doc.text_of(id)
    }

    pub fn image_of(&self, id: u32) -> Vec<u8> {
        self.doc.image_of(id).unwrap_or_default()
    }

    pub fn mime_of(&self, id: u32) -> String {
        self.doc.mime_of(id)
    }

    pub fn highlight(&self, id: u32) -> Vec<u32> {
        self.doc.highlight(id)
    }

    pub fn format_all(&mut self) -> String {
        match self.doc.format_all() {
            Ok(msg) => format!("ok:{msg}"),
            Err(msg) => format!("err:{msg}"),
        }
    }

    pub fn find(
        &self,
        query: &str,
        case_sensitive: bool,
        from_id: u32,
        from_pos: u32,
        backwards: bool,
    ) -> Option<Caret> {
        self.doc
            .find(query, case_sensitive, from_id, from_pos, backwards)
            .map(Caret::from)
    }

    pub fn find_count(&self, query: &str, case_sensitive: bool) -> u32 {
        self.doc.find_count(query, case_sensitive)
    }

    pub fn replace_all(&mut self, query: &str, replacement: &str, case_sensitive: bool) -> u32 {
        self.doc.replace_all(query, replacement, case_sensitive)
    }

    pub fn metrics(&self, id: u32, pos: u32) -> Vec<u32> {
        self.doc.metrics(id, pos).to_vec()
    }

    pub fn line_to_caret(&self, line: u32) -> Caret {
        self.doc.line_to_caret(line).into()
    }

    pub fn force_language(&mut self, lang: &str) {
        self.doc.force_language(LangMode::parse(lang));
    }

    pub fn set_language(&mut self, lang: &str) {
        self.doc.set_language(LangMode::parse(lang));
    }

    pub fn language(&self) -> String {
        self.doc.language_setting().as_str().to_string()
    }

    pub fn effective_language(&self, id: u32) -> String {
        self.doc.effective_lang(id).as_str().to_string()
    }

    pub fn set_eol(&mut self, eol: &str) -> bool {
        let Some(parsed) = Eol::parse(eol) else { return false };
        let before = self.doc.eol();
        if parsed == Eol::Mixed {
            return false;
        }
        self.doc.set_eol(parsed);
        self.doc.eol() != before
    }

    pub fn eol(&self) -> String {
        self.doc.eol().as_str().to_string()
    }

    pub fn eol_label(&self) -> String {
        self.doc.eol().label().to_string()
    }

    pub fn set_encoding(&mut self, enc: &str) -> String {
        let Some(parsed) = Encoding::parse(enc) else {
            return "err:Unknown encoding.".into();
        };
        match self.doc.set_encoding(parsed) {
            Ok(()) => "ok".into(),
            Err(err) => format!("err:{err}"),
        }
    }

    pub fn encoding(&self) -> String {
        self.doc.encoding().as_str().to_string()
    }

    pub fn encoding_label(&self) -> String {
        self.doc.encoding().label().to_string()
    }

    pub fn export_text(&self) -> String {
        self.doc.export_text()
    }

    pub fn export_bytes(&self) -> Result<Vec<u8>, JsValue> {
        self.doc.export_bytes().map_err(|e| JsValue::from_str(&e))
    }

    pub fn first_text_id(&self) -> u32 {
        self.doc.first_text_id()
    }

    // ---------- Tables ----------

    /// Loads a table from `{"cols":n,"cells":[{"t":"…","m":[…],"f":n}]}`.
    pub fn restore_table(&mut self, json: &str) -> u32 {
        #[derive(serde::Deserialize)]
        struct CellIn {
            #[serde(default)]
            t: String,
            #[serde(default)]
            m: Vec<u32>,
            #[serde(default)]
            f: u8,
        }
        #[derive(serde::Deserialize)]
        struct TableIn {
            #[serde(default)]
            cols: usize,
            #[serde(default)]
            cells: Vec<CellIn>,
        }
        match serde_json::from_str::<TableIn>(json) {
            Ok(parsed) => {
                let cells = parsed
                    .cells
                    .into_iter()
                    .map(|cell| Cell { text: cell.t, marks: unflatten(&cell.m), fill: cell.f })
                    .collect();
                self.doc.restore_table(parsed.cols, cells)
            }
            Err(_) => 0,
        }
    }

    pub fn table_json(&self, id: u32) -> String {
        self.doc.table_json(id)
    }

    pub fn table_insert_row(&mut self, id: u32, at: u32) -> bool {
        self.doc.table_insert_row(id, at)
    }

    pub fn table_delete_row(&mut self, id: u32, at: u32) -> bool {
        self.doc.table_delete_row(id, at)
    }

    pub fn table_insert_col(&mut self, id: u32, at: u32) -> bool {
        self.doc.table_insert_col(id, at)
    }

    pub fn table_delete_col(&mut self, id: u32, at: u32) -> bool {
        self.doc.table_delete_col(id, at)
    }

    pub fn table_set_text(&mut self, id: u32, row: u32, col: u32, text: &str) -> bool {
        self.doc.table_set_text(id, row, col, text)
    }

    pub fn table_set_marks(&mut self, id: u32, row: u32, col: u32, flat: &[u32]) -> bool {
        self.doc.table_set_marks(id, row, col, flat)
    }

    pub fn table_fill(&mut self, id: u32, target: &str, row: u32, col: u32, fill: u8) -> bool {
        self.doc.table_fill(id, target, row, col, fill)
    }
}
