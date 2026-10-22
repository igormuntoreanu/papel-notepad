use crate::lang::Lang;

pub const K_KEYWORD: u8 = 1;
pub const K_TYPE: u8 = 2;
pub const K_STRING: u8 = 3;
pub const K_COMMENT: u8 = 4;
pub const K_NUMBER: u8 = 5;
pub const K_FUNC: u8 = 6;
pub const K_TAG: u8 = 7;
pub const K_ATTR: u8 = 8;
pub const K_LIT: u8 = 9;
pub const K_META: u8 = 10;

pub fn highlight_text(text: &str, lang: Lang) -> Vec<(u32, u32, u8)> {
    match lang {
        Lang::Plain => Vec::new(),
        Lang::Json => hi_json(text),
        Lang::Html | Lang::Xml => hi_markup(text),
        Lang::Md => hi_md(text),
        Lang::Abap => hi_abap(text),
        other => hi_code(text, other),
    }
}

struct Cur<'a> {
    text: &'a str,
    b: &'a [u8],
    i: usize,
    u: u32,
    spans: Vec<(u32, u32, u8)>,
}

impl<'a> Cur<'a> {
    fn new(text: &'a str) -> Self {
        Self { text, b: text.as_bytes(), i: 0, u: 0, spans: Vec::new() }
    }

    fn bump(&mut self, byte_end: usize) -> u32 {
        let start = self.u;
        let slice = &self.text[self.i..byte_end];
        let n: u32 = slice.chars().map(|c| c.len_utf16() as u32).sum();
        self.u += n;
        self.i = byte_end;
        start
    }

    fn mark(&mut self, byte_end: usize, kind: u8) {
        let start = self.u;
        self.bump(byte_end);
        if self.u > start && kind != 0 {
            self.spans.push((start, self.u, kind));
        }
    }

    fn plain(&mut self, byte_end: usize) {
        self.bump(byte_end);
    }
}

fn hi_code(text: &str, lang: Lang) -> Vec<(u32, u32, u8)> {
    let mut c = Cur::new(text);
    let keys = keywords(lang);
    let types = typewords(lang);
    let hash_comment = matches!(lang, Lang::Python);
    let dash_comment = matches!(lang, Lang::Sql);
    let slash_comment = !matches!(lang, Lang::Python | Lang::Sql);
    let block_comment = !matches!(lang, Lang::Python);
    while c.i < c.b.len() {
        let i = c.i;
        if hash_comment && c.b[i] == b'#' {
            let end = line_end(c.b, i);
            c.mark(end, K_COMMENT);
            continue;
        }
        if dash_comment && c.b[i] == b'-' && c.b.get(i + 1) == Some(&b'-') {
            let end = line_end(c.b, i);
            c.mark(end, K_COMMENT);
            continue;
        }
        if slash_comment && c.b[i] == b'/' && c.b.get(i + 1) == Some(&b'/') {
            let end = line_end(c.b, i);
            c.mark(end, K_COMMENT);
            continue;
        }
        if block_comment && c.b[i] == b'/' && c.b.get(i + 1) == Some(&b'*') {
            let mut j = i + 2;
            while j + 1 < c.b.len() && !(c.b[j] == b'*' && c.b[j + 1] == b'/') {
                j += 1;
            }
            j = (j + 2).min(c.b.len());
            c.mark(j, K_COMMENT);
            continue;
        }
        if is_raw_rust(lang, c.b, i) {
            if let Some(end) = raw_string_end(c.b, i) {
                c.mark(end, K_STRING);
                continue;
            }
        }
        if c.b[i] == b'"' || c.b[i] == b'\'' || (c.b[i] == b'`' && lang == Lang::Js) {
            let quote = c.b[i];
            // char literal in c-like: 'x' or '\n'
            if quote == b'\'' && !matches!(lang, Lang::Python | Lang::Sql) {
                if let Some(end) = char_lit_end(c.b, i) {
                    c.mark(end, K_STRING);
                    continue;
                }
            }
            let end = string_end(c.b, i, quote);
            c.mark(end, K_STRING);
            continue;
        }
        if c.b[i] == b'#' && matches!(lang, Lang::C | Lang::Cpp) && line_start_hash(c.b, i) {
            let end = line_end(c.b, i);
            c.mark(end, K_META);
            continue;
        }
        if c.b[i].is_ascii_digit() || (c.b[i] == b'.' && c.b.get(i + 1).is_some_and(|d| d.is_ascii_digit())) {
            let mut j = i + 1;
            while j < c.b.len() && (c.b[j].is_ascii_alphanumeric() || c.b[j] == b'.' || c.b[j] == b'_') {
                j += 1;
            }
            c.mark(j, K_NUMBER);
            continue;
        }
        if is_ident_start(c.b[i]) {
            let mut j = i + 1;
            while j < c.b.len() && is_ident_cont(c.b[j]) {
                j += 1;
            }
            let word = &c.text[i..j];
            let kind = if (lang == Lang::Sql && keys.iter().any(|k| k.eq_ignore_ascii_case(word)))
                || (lang != Lang::Sql && keys.iter().any(|k| *k == word))
            {
                K_KEYWORD
            } else if types.iter().any(|k| *k == word) {
                K_TYPE
            } else if next_non_ws_is_paren(c.b, j) {
                K_FUNC
            } else if word.chars().next().is_some_and(|ch| ch.is_uppercase())
                && matches!(lang, Lang::Rust | Lang::Java | Lang::Cpp | Lang::Python)
            {
                K_TYPE
            } else {
                0
            };
            if kind == 0 {
                c.plain(j);
            } else {
                c.mark(j, kind);
            }
            continue;
        }
        c.plain(i + 1);
    }
    c.spans
}

fn hi_abap(text: &str) -> Vec<(u32, u32, u8)> {
    let mut c = Cur::new(text);
    let keys = abap_word_set();
    while c.i < c.b.len() {
        let i = c.i;
        if c.b[i] == b'"' {
            let end = line_end(c.b, i);
            c.mark(end, K_COMMENT);
            continue;
        }
        if c.b[i] == b'*' && (i == 0 || c.b[i - 1] == b'\n') {
            let end = line_end(c.b, i);
            c.mark(end, K_COMMENT);
            continue;
        }
        // star after whitespace at line start
        if c.b[i] == b'*' && line_is_star_comment(c.b, i) {
            let end = line_end(c.b, i);
            c.mark(end, K_COMMENT);
            continue;
        }
        if c.b[i] == b'\'' {
            let end = string_end(c.b, i, b'\'');
            c.mark(end, K_STRING);
            continue;
        }
        if is_ident_start(c.b[i]) || c.b[i] == b'-' {
            let mut j = i + 1;
            while j < c.b.len() && (is_ident_cont(c.b[j]) || c.b[j] == b'-') {
                j += 1;
            }
            let word = &c.text[i..j];
            let upper = word.to_ascii_uppercase();
            if keys.iter().any(|k| *k == upper) {
                c.mark(j, K_KEYWORD);
            } else {
                c.plain(j);
            }
            continue;
        }
        if c.b[i].is_ascii_digit() {
            let mut j = i + 1;
            while j < c.b.len() && (c.b[j].is_ascii_alphanumeric() || c.b[j] == b'.') {
                j += 1;
            }
            c.mark(j, K_NUMBER);
            continue;
        }
        c.plain(i + 1);
    }
    c.spans
}

fn line_is_star_comment(b: &[u8], star: usize) -> bool {
    let mut k = star;
    while k > 0 && b[k - 1] != b'\n' {
        k -= 1;
        if b[k] != b' ' && b[k] != b'\t' {
            return false;
        }
    }
    true
}

fn hi_json(text: &str) -> Vec<(u32, u32, u8)> {
    let mut c = Cur::new(text);
    let mut expect_key = true;
    while c.i < c.b.len() {
        let i = c.i;
        let ch = c.b[i];
        if ch == b'"' {
            let end = string_end(c.b, i, b'"');
            let kind = if expect_key { K_ATTR } else { K_STRING };
            c.mark(end, kind);
            expect_key = false;
            continue;
        }
        if ch == b'{' || ch == b'[' {
            expect_key = ch == b'{';
            c.plain(i + 1);
            continue;
        }
        if ch == b',' {
            expect_key = true;
            c.plain(i + 1);
            continue;
        }
        if ch == b':' {
            expect_key = false;
            c.plain(i + 1);
            continue;
        }
        if ch.is_ascii_digit() || (ch == b'-' && c.b.get(i + 1).is_some_and(|d| d.is_ascii_digit())) {
            let mut j = i + 1;
            while j < c.b.len() && (c.b[j].is_ascii_digit() || matches!(c.b[j], b'.' | b'e' | b'E' | b'+' | b'-')) {
                j += 1;
            }
            c.mark(j, K_NUMBER);
            expect_key = false;
            continue;
        }
        if is_ident_start(ch) {
            let mut j = i + 1;
            while j < c.b.len() && is_ident_cont(c.b[j]) {
                j += 1;
            }
            let word = &c.text[i..j];
            if matches!(word, "true" | "false" | "null") {
                c.mark(j, K_LIT);
            } else {
                c.plain(j);
            }
            expect_key = false;
            continue;
        }
        c.plain(i + 1);
    }
    c.spans
}

fn hi_markup(text: &str) -> Vec<(u32, u32, u8)> {
    let mut c = Cur::new(text);
    while c.i < c.b.len() {
        let i = c.i;
        if c.text[i..].starts_with("<!--") {
            if let Some(rel) = c.text[i..].find("-->") {
                c.mark(i + rel + 3, K_COMMENT);
            } else {
                c.mark(c.b.len(), K_COMMENT);
            }
            continue;
        }
        if c.b[i] == b'<' {
            let start_u = c.u;
            c.plain(i + 1);
            if c.i < c.b.len() && c.b[c.i] == b'/' {
                c.plain(c.i + 1);
            }
            if c.i < c.b.len() && is_ident_start(c.b[c.i]) {
                let name_start = c.i;
                let mut j = c.i + 1;
                while j < c.b.len() && (is_ident_cont(c.b[j]) || c.b[j] == b':' || c.b[j] == b'-') {
                    j += 1;
                }
                let _ = (start_u, name_start);
                c.mark(j, K_TAG);
            }
            while c.i < c.b.len() && c.b[c.i] != b'>' {
                if c.b[c.i] == b'"' || c.b[c.i] == b'\'' {
                    let end = string_end(c.b, c.i, c.b[c.i]);
                    c.mark(end, K_STRING);
                    continue;
                }
                if is_ident_start(c.b[c.i]) {
                    let mut j = c.i + 1;
                    while j < c.b.len() && (is_ident_cont(c.b[j]) || c.b[j] == b'-' || c.b[j] == b':') {
                        j += 1;
                    }
                    let next = j;
                    let is_attr = c.b[next..].iter().find(|b| !b.is_ascii_whitespace()).copied() == Some(b'=');
                    if is_attr {
                        c.mark(j, K_ATTR);
                    } else {
                        c.plain(j);
                    }
                    continue;
                }
                c.plain(c.i + 1);
            }
            if c.i < c.b.len() && c.b[c.i] == b'>' {
                c.plain(c.i + 1);
            }
            continue;
        }
        c.plain(i + 1);
    }
    c.spans
}

fn hi_md(text: &str) -> Vec<(u32, u32, u8)> {
    let mut c = Cur::new(text);
    let mut in_fence = false;
    while c.i < c.b.len() {
        let i = c.i;
        let at_line = i == 0 || c.b[i - 1] == b'\n';
        if at_line && c.text[i..].starts_with("```") {
            let end = line_end(c.b, i);
            c.mark(end, K_META);
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            let end = line_end(c.b, i);
            c.mark(end, K_STRING);
            continue;
        }
        if at_line {
            let mut j = i;
            while j < c.b.len() && c.b[j] == b'#' {
                j += 1;
            }
            if j > i && c.b.get(j) == Some(&b' ') {
                let end = line_end(c.b, i);
                c.mark(end, K_KEYWORD);
                continue;
            }
        }
        if c.b[i] == b'`' {
            let mut j = i + 1;
            while j < c.b.len() && c.b[j] != b'`' && c.b[j] != b'\n' {
                j += 1;
            }
            if j < c.b.len() && c.b[j] == b'`' {
                c.mark(j + 1, K_STRING);
                continue;
            }
        }
        c.plain(i + 1);
    }
    c.spans
}

fn line_end(b: &[u8], i: usize) -> usize {
    b[i..].iter().position(|c| *c == b'\n').map(|p| i + p + 1).unwrap_or(b.len())
}

fn line_start_hash(b: &[u8], i: usize) -> bool {
    let mut k = i;
    while k > 0 && b[k - 1] != b'\n' {
        k -= 1;
        if b[k] != b' ' && b[k] != b'\t' {
            return false;
        }
    }
    true
}

fn is_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_ident_cont(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn next_non_ws_is_paren(b: &[u8], mut j: usize) -> bool {
    while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
        j += 1;
    }
    b.get(j) == Some(&b'(')
}

fn string_end(b: &[u8], start: usize, quote: u8) -> usize {
    let mut j = start + 1;
    while j < b.len() {
        if b[j] == b'\\' {
            j = (j + 2).min(b.len());
            continue;
        }
        if b[j] == quote {
            return j + 1;
        }
        if b[j] == b'\n' && quote != b'`' && quote != b'"' {
            // allow multiline double quotes in rust-ish by not breaking... rust strings aren't multiline
            // except we still close on newline for single line safety? Rust raw handled elsewhere.
            // Keep going for JSON which shouldn't have raw newlines. Stop on newline for quotes other than `.
            if quote != b'"' || true {
                // stop so a missing closer doesn't paint the whole file
                if quote != b'`' {
                    return j;
                }
            }
        }
        j += 1;
    }
    b.len()
}

fn char_lit_end(b: &[u8], start: usize) -> Option<usize> {
    // 'x' or '\n' or '\'' — short
    let mut j = start + 1;
    if j >= b.len() {
        return None;
    }
    if b[j] == b'\\' {
        j += 2;
    } else {
        j += 1;
    }
    if b.get(j) == Some(&b'\'') {
        Some(j + 1)
    } else {
        None
    }
}

fn is_raw_rust(lang: Lang, b: &[u8], i: usize) -> bool {
    lang == Lang::Rust && b[i] == b'r' && (b.get(i + 1) == Some(&b'#') || b.get(i + 1) == Some(&b'"'))
}

fn raw_string_end(b: &[u8], start: usize) -> Option<usize> {
    let mut j = start + 1;
    let mut hashes = 0;
    while b.get(j) == Some(&b'#') {
        hashes += 1;
        j += 1;
    }
    if b.get(j) != Some(&b'"') {
        return None;
    }
    j += 1;
    while j < b.len() {
        if b[j] == b'"' {
            let mut h = 0;
            while h < hashes && b.get(j + 1 + h) == Some(&b'#') {
                h += 1;
            }
            if h == hashes {
                return Some(j + 1 + hashes);
            }
        }
        j += 1;
    }
    Some(b.len())
}

fn keywords(lang: Lang) -> &'static [&'static str] {
    match lang {
        Lang::Rust => &[
            "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum",
            "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
            "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super",
            "trait", "true", "type", "unsafe", "use", "where", "while",
        ],
        Lang::Java => &[
            "abstract", "assert", "break", "case", "catch", "class", "const", "continue", "default",
            "do", "else", "enum", "extends", "final", "finally", "for", "if", "implements", "import",
            "instanceof", "interface", "native", "new", "package", "private", "protected", "public",
            "return", "static", "strictfp", "super", "switch", "synchronized", "this", "throw",
            "throws", "transient", "try", "void", "volatile", "while", "true", "false", "null",
        ],
        Lang::C => &[
            "auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else",
            "enum", "extern", "float", "for", "goto", "if", "inline", "int", "long", "register",
            "restrict", "return", "short", "signed", "sizeof", "static", "struct", "switch",
            "typedef", "union", "unsigned", "void", "volatile", "while",
        ],
        Lang::Cpp => &[
            "alignas", "auto", "break", "case", "catch", "char", "class", "const", "constexpr",
            "continue", "default", "delete", "do", "double", "else", "enum", "explicit", "export",
            "extern", "false", "float", "for", "friend", "goto", "if", "inline", "int", "long",
            "namespace", "new", "noexcept", "nullptr", "operator", "private", "protected", "public",
            "return", "short", "signed", "sizeof", "static", "struct", "switch", "template", "this",
            "throw", "true", "try", "typedef", "typename", "union", "unsigned", "using", "virtual",
            "void", "volatile", "while",
        ],
        Lang::Js => &[
            "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger",
            "default", "delete", "do", "else", "export", "extends", "false", "finally", "for",
            "function", "if", "import", "in", "instanceof", "let", "new", "null", "return", "static",
            "super", "switch", "this", "throw", "true", "try", "typeof", "undefined", "var", "void",
            "while", "with", "yield", "of",
        ],
        Lang::Python => &[
            "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
            "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import",
            "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return",
            "True", "try", "while", "with", "yield",
        ],
        Lang::Sql => &[
            "select", "from", "where", "and", "or", "insert", "into", "values", "update", "set",
            "delete", "create", "table", "drop", "alter", "join", "left", "right", "inner", "outer",
            "on", "group", "by", "order", "having", "limit", "offset", "as", "distinct", "union",
            "all", "not", "null", "primary", "key", "foreign", "references", "index", "view",
            "begin", "commit", "rollback", "case", "when", "then", "else", "end", "in", "is",
            "like", "between", "exists", "SELECT", "FROM", "WHERE", "AND", "OR", "INSERT", "INTO",
            "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "JOIN", "LEFT", "RIGHT",
            "INNER", "ON", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "AS", "NULL", "NOT",
        ],
        Lang::Css => &[
            "important", "from", "to", "inherit", "initial", "unset", "none", "auto", "flex",
            "grid", "block", "inline", "absolute", "relative", "fixed", "sticky",
        ],
        _ => &[],
    }
}

fn typewords(lang: Lang) -> &'static [&'static str] {
    match lang {
        Lang::Rust => &[
            "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize",
            "f32", "f64", "bool", "char", "str", "String", "Vec", "Option", "Result",
        ],
        Lang::Java => &[
            "int", "long", "short", "byte", "float", "double", "boolean", "char", "void", "String",
            "Integer", "Boolean", "Object", "List", "Map",
        ],
        Lang::C | Lang::Cpp => &["int", "long", "short", "char", "float", "double", "void", "bool", "size_t"],
        Lang::Python => &["int", "str", "float", "bool", "list", "dict", "set", "tuple"],
        _ => &[],
    }
}

pub fn abap_word_set() -> &'static [&'static str] {
    &[
        "REPORT", "DATA", "TYPE", "TYPES", "IF", "ELSE", "ELSEIF", "ENDIF", "WRITE", "LOOP", "AT",
        "ENDLOOP", "FORM", "ENDFORM", "METHOD", "ENDMETHOD", "CLASS", "ENDCLASS", "PUBLIC",
        "PRIVATE", "PROTECTED", "SECTION", "DEFINITION", "IMPLEMENTATION", "RETURNING", "IMPORTING",
        "EXPORTING", "CHANGING", "VALUE", "CHECK", "CLEAR", "SELECT", "FROM", "WHERE", "INTO",
        "TABLE", "SINGLE", "ENDSELECT", "CALL", "FUNCTION", "AND", "OR", "NOT", "BEGIN", "OF",
        "END", "STRUCTURE", "CONSTANTS", "FIELD-SYMBOLS", "ASSIGN", "TO", "CASE", "WHEN", "ENDCASE",
        "TRY", "CATCH", "ENDTRY", "WHILE", "ENDWHILE", "DO", "ENDDO", "PERFORM", "USING", "TABLES",
        "PARAMETERS", "SELECT-OPTIONS", "START-OF-SELECTION", "INITIALIZATION", "CONCATENATE",
        "SEPARATED", "BY", "MOVE", "MOVE-CORRESPONDING", "APPEND", "READ", "INDEX", "WITH", "KEY",
        "SORT", "DELETE", "MODIFY", "INSERT", "UPDATE", "COMMIT", "WORK", "ROLLBACK", "MESSAGE",
        "RETURN", "EXIT", "CONTINUE", "CHANGING", "LIKE", "OCCURS", "WITH", "HEADER", "LINE",
    ]
}
