use crate::detect::detect;
use crate::encoding::{self, decode, encode, Encoding, Eol};
use crate::format::format_source;
use crate::highlight::highlight_text;
use crate::lang::{Lang, LangMode};
use crate::marks::{self, Run, StyleChange};
use crate::textutil::{count_lines, line_col, offset_of_line, slice_utf16, splice_utf16, utf16_len};

const HISTORY_LIMIT: usize = 200;
const MAX_IMAGE: usize = 12_000_000;

#[derive(Clone, Debug)]
enum Block {
    Text { id: u32, body: String, marks: Vec<Run> },
    Image { id: u32, mime: String, data: Vec<u8> },
}

fn text_block(id: u32, body: String) -> Block {
    Block::Text { id, body, marks: Vec::new() }
}

impl Block {
    fn id(&self) -> u32 {
        match self {
            Self::Text { id, .. } | Self::Image { id, .. } => *id,
        }
    }
}

#[derive(Clone, Debug)]
struct Meta {
    eol: Eol,
    encoding: Encoding,
    lang: LangMode,
}

#[derive(Clone, Debug)]
enum StepKind {
    Replace {
        id: u32,
        at: u32,
        deleted: String,
        inserted: String,
        marks_before: Vec<Run>,
        marks_after: Vec<Run>,
    },
    Marks { id: u32, before: Vec<Run>, after: Vec<Run> },
    Structure { before: Vec<Block>, after: Vec<Block> },
    Meta { before: Meta, after: Meta },
}

#[derive(Clone, Debug)]
struct Step {
    kind: StepKind,
    caret_before: Caret,
    caret_after: Caret,
    rev_before: u64,
    rev_after: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Caret {
    pub block_id: u32,
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Debug)]
pub struct OutlineItem {
    pub id: u32,
    pub kind: &'static str,
    pub mime: String,
}

pub struct Document {
    blocks: Vec<Block>,
    next_id: u32,
    undo: Vec<Step>,
    redo: Vec<Step>,
    revision: u64,
    saved: u64,
    eol: Eol,
    encoding: Encoding,
    lang: LangMode,
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

impl Document {
    pub fn new() -> Self {
        Self {
            blocks: vec![text_block(1, String::new())],
            next_id: 2,
            undo: Vec::new(),
            redo: Vec::new(),
            revision: 0,
            saved: 0,
            eol: Eol::Lf,
            encoding: Encoding::Utf8,
            lang: LangMode::Auto,
        }
    }

    fn alloc_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        id
    }

    fn meta(&self) -> Meta {
        Meta { eol: self.eol, encoding: self.encoding, lang: self.lang }
    }

    pub fn is_dirty(&self) -> bool {
        self.revision != self.saved
    }

    pub fn mark_clean(&mut self) {
        self.saved = self.revision;
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn eol(&self) -> Eol {
        self.eol
    }

    pub fn encoding(&self) -> Encoding {
        self.encoding
    }

    pub fn language_setting(&self) -> LangMode {
        self.lang
    }

    pub fn force_language(&mut self, mode: LangMode) {
        self.lang = mode;
    }

    pub fn set_language(&mut self, mode: LangMode) {
        if self.lang == mode {
            return;
        }
        let before = self.meta();
        self.lang = mode;
        self.push_meta(before);
    }

    pub fn set_eol(&mut self, eol: Eol) {
        if self.eol == eol {
            return;
        }
        let before = self.meta();
        self.eol = eol;
        self.push_meta(before);
    }

    pub fn set_encoding(&mut self, encoding: Encoding) -> Result<(), String> {
        if self.encoding == encoding {
            return Ok(());
        }
        encode(&self.export_text(), encoding, Eol::Lf)?;
        let before = self.meta();
        self.encoding = encoding;
        self.push_meta(before);
        Ok(())
    }

    pub fn open_bytes(&mut self, bytes: &[u8]) {
        let (text, enc, eol) = decode(bytes);
        self.blocks.clear();
        let id = self.alloc_id();
        self.blocks.push(text_block(id, text));
        self.encoding = enc;
        self.eol = eol;
        self.lang = LangMode::Auto;
        self.undo.clear();
        self.redo.clear();
        self.revision = 0;
        self.saved = 0;
    }

    pub fn restore_begin(&mut self) {
        self.blocks.clear();
        self.undo.clear();
        self.redo.clear();
        self.revision = 0;
        self.saved = 0;
    }

    pub fn restore_text(&mut self, text: &str) -> u32 {
        let id = self.alloc_id();
        self.blocks.push(text_block(id, encoding::normalize_eol(text)));
        id
    }

    /// Restores style runs for a text block (flat `[start, end, flags, ink, hl]*`).
    pub fn restore_marks(&mut self, id: u32, flat: &[u32]) {
        let Some(len) = self.text_len(id) else { return };
        if let Some(Block::Text { marks: m, .. }) = self.blocks.iter_mut().find(|b| b.id() == id) {
            *m = marks::clamp(marks::unflatten(flat), len);
        }
    }

    pub fn restore_image(&mut self, mime: &str, data: Vec<u8>) -> u32 {
        let id = self.alloc_id();
        self.blocks.push(Block::Image { id, mime: mime.to_string(), data });
        id
    }

    pub fn restore_end(&mut self, lang: &str, eol: &str, encoding_name: &str) {
        if self.blocks.is_empty() || !self.blocks.iter().any(|b| matches!(b, Block::Text { .. })) {
            let id = self.alloc_id();
            self.blocks.push(text_block(id, String::new()));
        }
        self.lang = LangMode::parse(lang);
        self.eol = Eol::parse(eol).unwrap_or(Eol::Lf);
        self.encoding = Encoding::parse(encoding_name).unwrap_or(Encoding::Utf8);
        self.undo.clear();
        self.redo.clear();
        self.revision = 0;
        self.saved = 0;
    }

    pub fn edit(&mut self, id: u32, mut start: u32, mut end: u32, text: &str, coalesce: bool) {
        if start > end {
            std::mem::swap(&mut start, &mut end);
        }
        let Some(len) = self.text_len(id) else { return };
        if start > len {
            start = len;
        }
        if end > len {
            end = len;
        }
        if start == end && text.is_empty() {
            return;
        }
        if coalesce && self.try_coalesce(id, start, end, text) {
            return;
        }
        let (deleted, marks_before, marks_after) = self.splice_block(id, start, end, text);
        let rev_before = self.revision;
        self.revision += 1;
        let after = start + utf16_len(text) as u32;
        self.push(Step {
            kind: StepKind::Replace { id, at: start, deleted, inserted: text.to_string(), marks_before, marks_after },
            caret_before: Caret { block_id: id, start, end },
            caret_after: Caret { block_id: id, start: after, end: after },
            rev_before,
            rev_after: self.revision,
        });
    }

    /// Splices text into a block and shifts its style runs. Returns (deleted, marks before, marks after).
    fn splice_block(&mut self, id: u32, start: u32, end: u32, text: &str) -> (String, Vec<Run>, Vec<Run>) {
        let inserted = utf16_len(text) as u32;
        let Some(Block::Text { body, marks: m, .. }) = self.blocks.iter_mut().find(|b| b.id() == id) else {
            return (String::new(), Vec::new(), Vec::new());
        };
        let deleted = splice_utf16(body, start as usize, end as usize, text);
        let before = m.clone();
        if !m.is_empty() {
            *m = marks::shift(m, start, end, inserted);
        }
        (deleted, before, m.clone())
    }

    fn try_coalesce(&mut self, id: u32, start: u32, end: u32, text: &str) -> bool {
        if !self.redo.is_empty() {
            return false;
        }
        let (bid, at, deleted_empty, inserted_empty, inserted_len) = {
            let Some(last) = self.undo.last() else { return false };
            let StepKind::Replace { id: bid, at, deleted, inserted, .. } = &last.kind else { return false };
            (*bid, *at, deleted.is_empty(), inserted.is_empty(), utf16_len(inserted) as u32)
        };
        if bid != id {
            return false;
        }
        if deleted_empty && start == end && !text.contains('\n') && utf16_len(text) <= 2 && start == at + inserted_len {
            let (_, _, after_marks) = self.splice_block(id, start, start, text);
            let last = self.undo.last_mut().expect("step");
            if let StepKind::Replace { inserted, marks_after, .. } = &mut last.kind {
                inserted.push_str(text);
                *marks_after = after_marks;
            }
            let after = start + utf16_len(text) as u32;
            last.caret_after = Caret { block_id: id, start: after, end: after };
            return true;
        }
        if text.is_empty() && start < end && inserted_empty && end == at {
            let (removed, _, after_marks) = self.splice_block(id, start, end, "");
            let last = self.undo.last_mut().expect("step");
            if let StepKind::Replace { at, deleted, marks_after, .. } = &mut last.kind {
                let mut combined = removed;
                combined.push_str(deleted);
                *deleted = combined;
                *at = start;
                *marks_after = after_marks;
            }
            last.caret_after = Caret { block_id: id, start, end: start };
            return true;
        }
        false
    }

    /// Applies an inline style change over `start..end` of a text block. Returns true if anything changed.
    pub fn apply_style(&mut self, id: u32, start: u32, end: u32, change: StyleChange) -> bool {
        let Some(len) = self.text_len(id) else { return false };
        let (start, end) = (start.min(end).min(len), start.max(end).min(len));
        if start == end {
            return false;
        }
        let Some(Block::Text { marks: m, .. }) = self.blocks.iter_mut().find(|b| b.id() == id) else {
            return false;
        };
        let next = marks::restyle(m, start, end, change);
        if next == *m {
            return false;
        }
        let before = std::mem::replace(m, next.clone());
        let rev_before = self.revision;
        self.revision += 1;
        let caret = Caret { block_id: id, start, end };
        self.push(Step {
            kind: StepKind::Marks { id, before, after: next },
            caret_before: caret,
            caret_after: caret,
            rev_before,
            rev_after: self.revision,
        });
        true
    }

    pub fn marks_of(&self, id: u32) -> Vec<Run> {
        self.blocks.iter().find_map(|b| match b {
            Block::Text { id: bid, marks: m, .. } if *bid == id => Some(m.clone()),
            _ => None,
        }).unwrap_or_default()
    }

    pub fn has_marks(&self) -> bool {
        self.blocks.iter().any(|b| matches!(b, Block::Text { marks: m, .. } if !m.is_empty()))
    }

    fn set_marks(&mut self, id: u32, next: &[Run]) {
        if let Some(Block::Text { marks: m, .. }) = self.blocks.iter_mut().find(|b| b.id() == id) {
            *m = next.to_vec();
        }
    }

    pub fn insert_image(&mut self, id: u32, at: u32, mime: &str, data: Vec<u8>) -> Option<Caret> {
        if data.is_empty() || data.len() > MAX_IMAGE {
            return None;
        }
        let idx = self.blocks.iter().position(|b| b.id() == id)?;
        let body = match &self.blocks[idx] {
            Block::Text { body, .. } => body.clone(),
            _ => return None,
        };
        let before = self.blocks.clone();
        let at = at.min(utf16_len(&body) as u32);
        let left = slice_utf16(&body, 0, at as usize);
        let right = slice_utf16(&body, at as usize, utf16_len(&body));
        let image_id = self.alloc_id();
        let right_id = self.alloc_id();
        let mime = if mime.starts_with("image/") { mime.to_string() } else { "image/png".into() };
        let mut right_marks = Vec::new();
        if let Block::Text { body, marks: m, .. } = &mut self.blocks[idx] {
            *body = left;
            let (l, r) = marks::split(m, at);
            *m = l;
            right_marks = r;
        }
        self.blocks.insert(idx + 1, Block::Image { id: image_id, mime, data });
        self.blocks.insert(idx + 2, Block::Text { id: right_id, body: right, marks: right_marks });
        let caret_before = Caret { block_id: id, start: at, end: at };
        let caret_after = Caret { block_id: right_id, start: 0, end: 0 };
        self.push_structure(before, caret_before, caret_after);
        Some(caret_after)
    }

    pub fn delete_image(&mut self, image_id: u32) -> Option<Caret> {
        let idx = self.blocks.iter().position(|b| matches!(b, Block::Image { id, .. } if *id == image_id))?;
        let before = self.blocks.clone();
        let caret_before = Caret { block_id: image_id, start: 0, end: 0 };
        let prev = if idx > 0 { Some(idx - 1) } else { None };
        self.blocks.remove(idx);
        let caret = if let Some(p) = prev {
            if let Block::Text { id: pid, body, .. } = &self.blocks[p] {
                let pid = *pid;
                let join = utf16_len(body) as u32;
                if p + 1 < self.blocks.len() {
                    if let Block::Text { body: right, marks: right_marks, .. } = &self.blocks[p + 1] {
                        let right = right.clone();
                        let right_marks = right_marks.clone();
                        if let Block::Text { body, marks: m, .. } = &mut self.blocks[p] {
                            body.push_str(&right);
                            *m = marks::join(m, &right_marks, join);
                        }
                        self.blocks.remove(p + 1);
                    }
                }
                Caret { block_id: pid, start: join, end: join }
            } else if idx < self.blocks.len() {
                // idx was removed; the following block slid into idx, but we used prev path
                self.fallback_caret()
            } else {
                self.fallback_caret()
            }
        } else if !self.blocks.is_empty() {
            match &self.blocks[0] {
                Block::Text { id, .. } => Caret { block_id: *id, start: 0, end: 0 },
                Block::Image { id, .. } => Caret { block_id: *id, start: 0, end: 0 },
            }
        } else {
            let id = self.alloc_id();
            self.blocks.push(text_block(id, String::new()));
            Caret { block_id: id, start: 0, end: 0 }
        };
        if !self.blocks.iter().any(|b| matches!(b, Block::Text { .. })) {
            let id = self.alloc_id();
            self.blocks.push(text_block(id, String::new()));
        }
        self.push_structure(before, caret_before, caret);
        Some(caret)
    }

    fn fallback_caret(&self) -> Caret {
        if let Some(Block::Text { id, .. }) = self.blocks.iter().find(|b| matches!(b, Block::Text { .. })) {
            Caret { block_id: *id, start: 0, end: 0 }
        } else {
            Caret { block_id: 0, start: 0, end: 0 }
        }
    }

    pub fn undo(&mut self) -> Option<Caret> {
        let step = self.undo.pop()?;
        let caret = caret_before_of(&step);
        self.invert(&step);
        self.revision = step.rev_before;
        self.redo.push(step);
        Some(caret)
    }

    pub fn redo(&mut self) -> Option<Caret> {
        let step = self.redo.pop()?;
        let caret = step.caret_after;
        self.reapply(&step);
        self.revision = step.rev_after;
        self.undo.push(step);
        Some(caret)
    }

    fn invert(&mut self, step: &Step) {
        match &step.kind {
            StepKind::Replace { id, at, deleted, inserted, marks_before, .. } => {
                self.apply_replace(*id, *at, inserted, deleted);
                self.set_marks(*id, marks_before);
            }
            StepKind::Marks { id, before, .. } => self.set_marks(*id, before),
            StepKind::Structure { before, .. } => self.blocks = before.clone(),
            StepKind::Meta { before, .. } => self.apply_meta(before),
        }
    }

    fn reapply(&mut self, step: &Step) {
        match &step.kind {
            StepKind::Replace { id, at, deleted, inserted, marks_after, .. } => {
                self.apply_replace(*id, *at, deleted, inserted);
                self.set_marks(*id, marks_after);
            }
            StepKind::Marks { id, after, .. } => self.set_marks(*id, after),
            StepKind::Structure { after, .. } => self.blocks = after.clone(),
            StepKind::Meta { after, .. } => self.apply_meta(after),
        }
    }

    fn apply_replace(&mut self, id: u32, at: u32, remove: &str, insert: &str) {
        let Some(body) = self.text_body_mut(id) else { return };
        let end = at + utf16_len(remove) as u32;
        splice_utf16(body, at as usize, end as usize, insert);
    }

    fn apply_meta(&mut self, meta: &Meta) {
        self.eol = meta.eol;
        self.encoding = meta.encoding;
        self.lang = meta.lang;
    }

    pub fn format_all(&mut self) -> Result<String, String> {
        let before = self.blocks.clone();
        let mut names: Vec<&'static str> = Vec::new();
        let mut changed = false;
        let mut first_err: Option<String> = None;
        for block in &mut self.blocks {
            let Block::Text { id, body, marks: m } = block else { continue };
            if body.trim().is_empty() {
                continue;
            }
            let lang = match self.lang {
                LangMode::Fixed(lang) => lang,
                LangMode::Auto => match detect(body) {
                    Some(lang) => lang,
                    None => continue,
                },
            };
            if lang == Lang::Plain {
                continue;
            }
            match format_source(body, lang) {
                Ok(next) => {
                    if next != *body {
                        *body = next;
                        m.clear();
                        changed = true;
                    }
                    if !names.contains(&lang.label()) {
                        names.push(lang.label());
                    }
                    let _ = id;
                }
                Err(err) => {
                    first_err = Some(err);
                    break;
                }
            }
        }
        if let Some(err) = first_err {
            self.blocks = before;
            return Err(err);
        }
        if !changed {
            self.blocks = before;
            return if names.is_empty() {
                Err("Doesn't look like code, so nothing was changed.".into())
            } else {
                Ok("Already formatted.".into())
            };
        }
        let caret = self.fallback_caret();
        self.push_structure(before, caret, caret);
        let list = names.join(" and ");
        Ok(format!("Formatted as {list}."))
    }

    pub fn find(
        &self,
        query: &str,
        case_sensitive: bool,
        from_id: u32,
        from_pos: u32,
        backwards: bool,
    ) -> Option<Caret> {
        if query.is_empty() {
            return None;
        }
        let ids: Vec<u32> = self.blocks.iter().filter_map(|b| match b {
            Block::Text { id, .. } => Some(*id),
            _ => None,
        }).collect();
        if ids.is_empty() {
            return None;
        }
        let start_idx = ids.iter().position(|id| *id == from_id).unwrap_or(0);
        if !backwards {
            for (n, id) in ids.iter().enumerate().skip(start_idx) {
                let from = if n == start_idx { from_pos } else { 0 };
                if let Some((s, e)) = find_in(self.text_of(*id).as_str(), query, from as usize, case_sensitive, false) {
                    return Some(Caret { block_id: *id, start: s as u32, end: e as u32 });
                }
            }
        } else {
            for n in (0..=start_idx).rev() {
                let id = ids[n];
                let text = self.text_of(id);
                let from = if n == start_idx { from_pos } else { utf16_len(&text) as u32 };
                if let Some((s, e)) = find_in(&text, query, from as usize, case_sensitive, true) {
                    return Some(Caret { block_id: id, start: s as u32, end: e as u32 });
                }
            }
        }
        None
    }

    pub fn find_count(&self, query: &str, case_sensitive: bool) -> u32 {
        if query.is_empty() {
            return 0;
        }
        self.blocks.iter().map(|b| match b {
            Block::Text { body, .. } => count_in(body, query, case_sensitive),
            _ => 0,
        }).sum()
    }

    pub fn replace_all(&mut self, query: &str, replacement: &str, case_sensitive: bool) -> u32 {
        if query.is_empty() {
            return 0;
        }
        let before = self.blocks.clone();
        let mut count = 0u32;
        for block in &mut self.blocks {
            if let Block::Text { body, marks: m, .. } = block {
                let matches = all_matches(body, query, case_sensitive);
                if matches.is_empty() {
                    continue;
                }
                let ins = utf16_len(replacement) as u32;
                for (start, end) in matches.iter().rev() {
                    splice_utf16(body, *start, *end, replacement);
                    if !m.is_empty() {
                        *m = marks::shift(m, *start as u32, *end as u32, ins);
                    }
                }
                count += matches.len() as u32;
            }
        }
        if count == 0 {
            return 0;
        }
        let caret = self.fallback_caret();
        self.push_structure(before, caret, caret);
        count
    }

    pub fn highlight(&self, id: u32) -> Vec<u32> {
        let text = self.text_of(id);
        let lang = self.effective_lang(id);
        let spans = highlight_text(&text, lang);
        let mut out = Vec::with_capacity(spans.len() * 3);
        for (a, b, k) in spans {
            out.push(a);
            out.push(b);
            out.push(k as u32);
        }
        out
    }

    pub fn effective_lang(&self, id: u32) -> Lang {
        match self.lang {
            LangMode::Fixed(lang) => lang,
            LangMode::Auto => detect(&self.text_of(id)).unwrap_or(Lang::Plain),
        }
    }

    pub fn metrics(&self, id: u32, pos: u32) -> [u32; 4] {
        let mut concat = String::new();
        let mut offset = 0u32;
        let mut found = 0u32;
        let mut seen = false;
        for block in &self.blocks {
            if let Block::Text { id: bid, body, .. } = block {
                if *bid == id {
                    let len = utf16_len(body) as u32;
                    found = offset + pos.min(len);
                    seen = true;
                }
                offset += utf16_len(body) as u32;
                concat.push_str(body);
            }
        }
        if !seen {
            found = 0;
        }
        let (line, col) = line_col(&concat, found as usize);
        [line, col, count_lines(&concat), concat.chars().count() as u32]
    }

    pub fn line_to_caret(&self, line: u32) -> Caret {
        let mut concat = String::new();
        let mut spans: Vec<(u32, u32)> = Vec::new();
        let mut offset = 0u32;
        for block in &self.blocks {
            if let Block::Text { id, body, .. } = block {
                spans.push((*id, offset));
                offset += utf16_len(body) as u32;
                concat.push_str(body);
            }
        }
        if spans.is_empty() {
            return Caret { block_id: 0, start: 0, end: 0 };
        }
        let lines = count_lines(&concat).max(1);
        let line = line.clamp(1, lines);
        let at = offset_of_line(&concat, line) as u32;
        let mut chosen = spans[0];
        for span in &spans {
            if span.1 <= at {
                chosen = *span;
            }
        }
        let pos = at - chosen.1;
        Caret { block_id: chosen.0, start: pos, end: pos }
    }

    pub fn outline(&self) -> Vec<OutlineItem> {
        self.blocks.iter().map(|b| match b {
            Block::Text { id, .. } => OutlineItem { id: *id, kind: "text", mime: String::new() },
            Block::Image { id, mime, .. } => OutlineItem { id: *id, kind: "image", mime: mime.clone() },
        }).collect()
    }

    pub fn outline_json(&self) -> String {
        let items: Vec<serde_json::Value> = self.outline().into_iter().map(|item| {
            serde_json::json!({ "id": item.id, "kind": item.kind, "mime": item.mime })
        }).collect();
        serde_json::Value::Array(items).to_string()
    }

    pub fn text_of(&self, id: u32) -> String {
        self.blocks.iter().find_map(|b| match b {
            Block::Text { id: bid, body, .. } if *bid == id => Some(body.clone()),
            _ => None,
        }).unwrap_or_default()
    }

    pub fn image_of(&self, id: u32) -> Option<Vec<u8>> {
        self.blocks.iter().find_map(|b| match b {
            Block::Image { id: bid, data, .. } if *bid == id => Some(data.clone()),
            _ => None,
        })
    }

    pub fn mime_of(&self, id: u32) -> String {
        self.blocks.iter().find_map(|b| match b {
            Block::Image { id: bid, mime, .. } if *bid == id => Some(mime.clone()),
            _ => None,
        }).unwrap_or_default()
    }

    pub fn export_text(&self) -> String {
        let mut out = String::new();
        for block in &self.blocks {
            if let Block::Text { body, .. } = block {
                out.push_str(body);
            }
        }
        out
    }

    pub fn export_bytes(&self) -> Result<Vec<u8>, String> {
        encode(&self.export_text(), self.encoding, self.eol)
    }

    pub fn first_text_id(&self) -> u32 {
        self.blocks.iter().find_map(|b| match b {
            Block::Text { id, .. } => Some(*id),
            _ => None,
        }).unwrap_or(0)
    }

    fn text_len(&self, id: u32) -> Option<u32> {
        self.blocks.iter().find_map(|b| match b {
            Block::Text { id: bid, body, .. } if *bid == id => Some(utf16_len(body) as u32),
            _ => None,
        })
    }

    fn text_body_mut(&mut self, id: u32) -> Option<&mut String> {
        self.blocks.iter_mut().find_map(|b| match b {
            Block::Text { id: bid, body, .. } if *bid == id => Some(body),
            _ => None,
        })
    }

    fn push(&mut self, step: Step) {
        self.redo.clear();
        self.undo.push(step);
        if self.undo.len() > HISTORY_LIMIT {
            self.undo.remove(0);
        }
    }

    fn push_meta(&mut self, before: Meta) {
        let after = self.meta();
        let rev_before = self.revision;
        self.revision += 1;
        let caret = self.fallback_caret();
        self.push(Step {
            kind: StepKind::Meta { before, after },
            caret_before: caret,
            caret_after: caret,
            rev_before,
            rev_after: self.revision,
        });
    }

    fn push_structure(&mut self, before: Vec<Block>, caret_before: Caret, caret_after: Caret) {
        let after = self.blocks.clone();
        let rev_before = self.revision;
        self.revision += 1;
        self.push(Step {
            kind: StepKind::Structure { before, after },
            caret_before,
            caret_after,
            rev_before,
            rev_after: self.revision,
        });
    }
}

fn caret_before_of(step: &Step) -> Caret {
    match &step.kind {
        StepKind::Replace { id, at, deleted, .. } => {
            let end = *at + utf16_len(deleted) as u32;
            Caret { block_id: *id, start: end, end: end }
        }
        _ => step.caret_before,
    }
}

fn find_in(hay: &str, needle: &str, from: usize, case_sensitive: bool, backwards: bool) -> Option<(usize, usize)> {
    if needle.is_empty() {
        return None;
    }
    let matches = all_matches(hay, needle, case_sensitive);
    if backwards {
        matches.into_iter().rev().find(|(s, _)| *s < from)
    } else {
        matches.into_iter().find(|(s, _)| *s >= from)
    }
}

fn count_in(hay: &str, needle: &str, case_sensitive: bool) -> u32 {
    all_matches(hay, needle, case_sensitive).len() as u32
}

fn all_matches(hay: &str, needle: &str, case_sensitive: bool) -> Vec<(usize, usize)> {
    let hay_chars: Vec<(usize, char)> = {
        let mut u = 0usize;
        hay.chars().map(|ch| {
            let at = u;
            u += ch.len_utf16();
            (at, ch)
        }).collect()
    };
    let needle_chars: Vec<char> = needle.chars().collect();
    if needle_chars.is_empty() || hay_chars.len() < needle_chars.len() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i + needle_chars.len() <= hay_chars.len() {
        let eq = hay_chars[i..i + needle_chars.len()].iter().zip(needle_chars.iter()).all(|((_, a), b)| {
            if case_sensitive { a == b } else { fold_eq(*a, *b) }
        });
        if eq {
            let start = hay_chars[i].0;
            let end_idx = i + needle_chars.len();
            let end = if end_idx < hay_chars.len() {
                hay_chars[end_idx].0
            } else {
                utf16_len(hay)
            };
            out.push((start, end));
            i += needle_chars.len();
        } else {
            i += 1;
        }
    }
    out
}

fn fold_eq(a: char, b: char) -> bool {
    if a == b {
        return true;
    }
    if a.is_ascii() && b.is_ascii() {
        return a.eq_ignore_ascii_case(&b);
    }
    let al: String = a.to_lowercase().collect();
    let bl: String = b.to_lowercase().collect();
    al == bl
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id_of(doc: &Document) -> u32 {
        doc.first_text_id()
    }

    #[test]
    fn typing_coalesces_and_undoes() {
        let mut doc = Document::new();
        let id = id_of(&doc);
        doc.edit(id, 0, 0, "a", false);
        doc.edit(id, 1, 1, "b", true);
        doc.edit(id, 2, 2, "c", true);
        assert_eq!(doc.text_of(id), "abc");
        doc.undo();
        assert_eq!(doc.text_of(id), "");
        doc.redo();
        assert_eq!(doc.text_of(id), "abc");
    }

    #[test]
    fn selection_replace_roundtrip() {
        let mut doc = Document::new();
        let id = id_of(&doc);
        doc.edit(id, 0, 0, "hello", false);
        doc.edit(id, 1, 4, "i", false);
        assert_eq!(doc.text_of(id), "hio");
        doc.undo();
        assert_eq!(doc.text_of(id), "hello");
    }

    #[test]
    fn emoji_offsets_survive() {
        let mut doc = Document::new();
        let id = id_of(&doc);
        doc.edit(id, 0, 0, "a😀b", false);
        doc.edit(id, 3, 3, "c", false);
        assert_eq!(doc.text_of(id), "a😀cb");
    }

    #[test]
    fn image_splits_and_merges() {
        let mut doc = Document::new();
        let id = id_of(&doc);
        doc.edit(id, 0, 0, "hello", false);
        let caret = doc.insert_image(id, 2, "image/png", vec![1, 2, 3]).unwrap();
        assert_eq!(doc.text_of(id), "he");
        assert_eq!(doc.text_of(caret.block_id), "llo");
        let images: Vec<_> = doc.outline().into_iter().filter(|i| i.kind == "image").collect();
        assert_eq!(images.len(), 1);
        doc.delete_image(images[0].id);
        assert_eq!(doc.export_text(), "hello");
        assert_eq!(doc.outline().len(), 1);
    }

    #[test]
    fn format_json_and_refuse_prose() {
        let mut doc = Document::new();
        let id = id_of(&doc);
        doc.edit(id, 0, 0, r#"{"a":1,"b":[2,3]}"#, false);
        let msg = doc.format_all().unwrap();
        assert!(msg.contains("JSON"), "{msg}");
        assert!(doc.text_of(id).contains("\n"));
        doc.undo();
        assert_eq!(doc.text_of(id), r#"{"a":1,"b":[2,3]}"#);

        let mut letter = Document::new();
        let id = id_of(&letter);
        letter.edit(id, 0, 0, "Hello, this is a letter about the house.", false);
        assert!(letter.format_all().is_err());
        assert_eq!(letter.text_of(id), "Hello, this is a letter about the house.");
    }

    #[test]
    fn format_java_c_abap() {
        let java = format_source(
            "public class A{public static void main(String[] args){System.out.println(\"hi\");}}",
            Lang::Java,
        ).unwrap();
        assert!(java.contains("public class A {"), "{java}");
        assert!(java.contains("System.out.println(\"hi\");"), "{java}");

        let c = format_source(
            "int main(){for(int i=0;i<3;i++){printf(\"%d\",i);}return 0;}",
            Lang::C,
        ).unwrap();
        let for_line = c.lines().find(|l| l.contains("for")).unwrap_or("");
        assert_eq!(for_line.matches(';').count(), 2, "{c}");
        assert!(c.contains("printf(\"%d\""), "{c}");
        assert!(c.contains("return 0;"), "{c}");

        let abap = format_source(
            "report zdemo.\nif sy-subrc = 0.\nwrite 'ok'.\nelse.\nwrite 'no'.\nendif.",
            Lang::Abap,
        ).unwrap();
        assert!(abap.contains("REPORT zdemo."), "{abap}");
        assert!(abap.contains("    WRITE 'ok'."), "{abap}");
        assert!(abap.contains("ENDIF."), "{abap}");
    }

    #[test]
    fn encoding_and_eol() {
        let (text, enc, eol) = decode(b"a\r\nb\r\n");
        assert_eq!(text, "a\nb\n");
        assert_eq!(enc, Encoding::Utf8);
        assert_eq!(eol, Eol::Crlf);
        let bytes = encode(&text, Encoding::Utf8, Eol::Crlf).unwrap();
        assert_eq!(bytes, b"a\r\nb\r\n");

        let (text, enc, _) = decode(&[0xE9]);
        assert_eq!(enc, Encoding::Windows1252);
        assert_eq!(text, "é");
        assert_eq!(encode("é", Encoding::Windows1252, Eol::Lf).unwrap(), vec![0xE9]);

        let mut doc = Document::new();
        let id = id_of(&doc);
        doc.edit(id, 0, 0, "hi 😀", false);
        assert!(doc.set_encoding(Encoding::Windows1252).is_err());
        assert_eq!(doc.encoding(), Encoding::Utf8);
    }

    #[test]
    fn find_replace_and_dirty() {
        let mut doc = Document::new();
        let id = id_of(&doc);
        assert!(!doc.is_dirty());
        doc.edit(id, 0, 0, "Alpha alpha", false);
        assert!(doc.is_dirty());
        let hit = doc.find("alpha", false, id, 0, false).unwrap();
        assert_eq!(hit.start, 0);
        assert_eq!(doc.find_count("alpha", false), 2);
        assert_eq!(doc.replace_all("alpha", "beta", false), 2);
        assert_eq!(doc.text_of(id), "beta beta");
        doc.undo();
        assert_eq!(doc.text_of(id), "Alpha alpha");
        doc.mark_clean();
        assert!(!doc.is_dirty());
        doc.edit(id, 0, 0, "x", false);
        doc.undo();
        assert!(!doc.is_dirty());
    }

    #[test]
    fn detects_languages() {
        assert_eq!(detect(r#"{"a":1}"#), Some(Lang::Json));
        assert_eq!(detect("public class A {\n  void main() {}\n}"), Some(Lang::Java));
        assert_eq!(detect("REPORT zdemo.\nWRITE 'x'.\n"), Some(Lang::Abap));
        assert_eq!(detect("#include <stdio.h>\nint main(){return 0;}\n"), Some(Lang::C));
        assert_eq!(detect("fn main() {\n    let mut x = 1;\n}\n"), Some(Lang::Rust));
        assert_eq!(detect("def greet():\n    return 1\n"), Some(Lang::Python));
        assert_eq!(detect("SELECT id FROM users WHERE id = 1"), Some(Lang::Sql));
        assert_eq!(detect("Hello, this is a letter about the house."), None);
        assert!(detect("fn main() {}").is_some());
        let spans = highlight_text("fn main() {}", Lang::Rust);
        assert!(spans.iter().any(|(_, _, k)| *k == crate::highlight::K_KEYWORD));
    }

    #[test]
    fn styles_undo_split_and_replace() {
        use crate::marks::{StyleChange, BOLD};
        let mut doc = Document::new();
        let id = id_of(&doc);
        doc.edit(id, 0, 0, "hello world", false);
        assert!(!doc.has_marks());
        assert!(doc.apply_style(id, 0, 5, StyleChange::Flag(BOLD, true)));
        assert!(doc.has_marks());
        assert_eq!(doc.marks_of(id)[0].end, 5);

        doc.edit(id, 5, 5, "!", true);
        assert_eq!(doc.marks_of(id)[0].end, 6, "typing at the end continues bold");
        doc.undo();
        assert_eq!(doc.marks_of(id)[0].end, 5);
        doc.undo();
        assert!(!doc.has_marks(), "style undo");
        doc.redo();
        assert!(doc.has_marks());

        doc.edit(id, 0, 5, "", false);
        assert!(!doc.has_marks());
        doc.undo();
        assert_eq!(doc.marks_of(id).len(), 1, "deleted styled text comes back styled");

        let caret = doc.insert_image(id, 3, "image/png", vec![1]).unwrap();
        assert_eq!(doc.marks_of(id)[0].end, 3);
        assert_eq!(doc.marks_of(caret.block_id)[0].end, 2);
        let img = doc.outline().into_iter().find(|i| i.kind == "image").unwrap();
        doc.delete_image(img.id);
        assert_eq!(doc.marks_of(id)[0].end, 5);

        assert_eq!(doc.replace_all("hello", "hi", false), 1);
        assert_eq!(doc.text_of(id), "hi world");
        assert_eq!(doc.marks_of(id)[0].end, 2);
    }

    #[test]
    fn utf16_bom_and_metrics() {
        let mut raw = vec![0xEF, 0xBB, 0xBF];
        raw.extend_from_slice("é".as_bytes());
        let (text, enc, _) = decode(&raw);
        assert_eq!(enc, Encoding::Utf8Bom);
        assert_eq!(text, "é");

        let mut doc = Document::new();
        let id = id_of(&doc);
        doc.edit(id, 0, 0, "ab\nc", false);
        let m = doc.metrics(id, 3);
        assert_eq!(m[0], 2, "line");
        assert_eq!(m[1], 1, "col");
        let caret = doc.line_to_caret(2);
        assert_eq!(caret.start, 3);
    }
}
