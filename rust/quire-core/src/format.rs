use crate::lang::Lang;

pub fn format_source(text: &str, lang: Lang) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Nothing to format.".into());
    }
    let formatted = match lang {
        Lang::Plain => return Err("Doesn't look like code, so nothing was changed.".into()),
        Lang::Json => format_json(text)?,
        Lang::Html => pretty_markup(text, true)?,
        Lang::Xml => pretty_markup(text, false)?,
        Lang::Css | Lang::Js | Lang::Java | Lang::C | Lang::Cpp | Lang::Rust => pretty_braces(text, lang),
        Lang::Sql => pretty_sql(text),
        Lang::Python => pretty_python(text),
        Lang::Abap => pretty_abap(text),
        Lang::Md => pretty_md(text),
    };
    Ok(formatted)
}

fn format_json(text: &str) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(text.trim()).map_err(|_| {
        "Looks like JSON but it doesn't parse, so nothing was changed.".to_string()
    })?;
    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}

#[derive(Clone, Debug)]
enum Tok {
    Word(String),
    Punct(String),
    Str(String),
    Comment(String),
    Raw(String),
}

fn lex_code(src: &str, lang: Lang) -> Vec<Tok> {
    let b = src.as_bytes();
    let mut i = 0;
    let mut toks = Vec::new();
    let mut line_start = true;
    while i < b.len() {
        let c = b[i];
        if c == b' ' || c == b'\t' || c == b'\r' {
            i += 1;
            continue;
        }
        if c == b'\n' {
            i += 1;
            line_start = true;
            continue;
        }
        if line_start && c == b'#' && matches!(lang, Lang::C | Lang::Cpp) {
            let end = mem_line(b, i);
            toks.push(Tok::Raw(src[i..end].trim_end_matches(['\n', '\r']).to_string()));
            i = end;
            line_start = true;
            continue;
        }
        line_start = false;
        if c == b'/' && b.get(i + 1) == Some(&b'/') && !matches!(lang, Lang::Python | Lang::Sql) {
            let end = mem_line(b, i);
            toks.push(Tok::Comment(src[i..end].trim_end_matches(['\n', '\r']).to_string()));
            i = end;
            line_start = true;
            continue;
        }
        if c == b'/' && b.get(i + 1) == Some(&b'*') && lang != Lang::Python {
            let mut j = i + 2;
            while j + 1 < b.len() && !(b[j] == b'*' && b[j + 1] == b'/') {
                j += 1;
            }
            j = (j + 2).min(b.len());
            toks.push(Tok::Comment(src[i..j].to_string()));
            i = j;
            continue;
        }
        if c == b'#' && lang == Lang::Python {
            let end = mem_line(b, i);
            toks.push(Tok::Comment(src[i..end].trim_end_matches(['\n', '\r']).to_string()));
            i = end;
            line_start = true;
            continue;
        }
        if c == b'-' && b.get(i + 1) == Some(&b'-') && lang == Lang::Sql {
            let end = mem_line(b, i);
            toks.push(Tok::Comment(src[i..end].trim_end_matches(['\n', '\r']).to_string()));
            i = end;
            line_start = true;
            continue;
        }
        if lang == Lang::Rust && c == b'r' && (b.get(i + 1) == Some(&b'"') || b.get(i + 1) == Some(&b'#')) {
            if let Some(end) = raw_end(b, i) {
                toks.push(Tok::Str(src[i..end].to_string()));
                i = end;
                continue;
            }
        }
        if c == b'"' || c == b'\'' || (c == b'`' && lang == Lang::Js) {
            let end = scan_string(b, i, c);
            toks.push(Tok::Str(src[i..end].to_string()));
            i = end;
            continue;
        }
        if c.is_ascii_digit() {
            let mut j = i + 1;
            if c == b'0' && matches!(b.get(j), Some(b'x' | b'X' | b'b' | b'B')) {
                j += 1;
                while j < b.len() && (b[j].is_ascii_hexdigit() || b[j] == b'_') {
                    j += 1;
                }
            } else {
                while j < b.len() && (b[j].is_ascii_digit() || b[j] == b'_') {
                    j += 1;
                }
                if b.get(j) == Some(&b'.') && b.get(j + 1).is_some_and(|d| d.is_ascii_digit()) {
                    j += 1;
                    while j < b.len() && (b[j].is_ascii_digit() || b[j] == b'_') {
                        j += 1;
                    }
                }
            }
            toks.push(Tok::Word(src[i..j].to_string()));
            i = j;
            continue;
        }
        if is_ident_start(c) {
            let mut j = i + 1;
            while j < b.len() && is_ident_cont(b[j]) {
                j += 1;
            }
            toks.push(Tok::Word(src[i..j].to_string()));
            i = j;
            continue;
        }
        let three = if i + 2 < b.len() { &src[i..i + 3] } else { "" };
        let two = if i + 1 < b.len() { &src[i..i + 2] } else { "" };
        const TRI: &[&str] = &["<<=", ">>=", "..."];
        const DUO: &[&str] = &[
            "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "->",
            "::", "<<", ">>", "&=", "|=", "^=", "?.", "??",
        ];
        if TRI.iter().any(|t| *t == three) {
            toks.push(Tok::Punct(three.to_string()));
            i += 3;
            continue;
        }
        if DUO.iter().any(|t| *t == two) {
            toks.push(Tok::Punct(two.to_string()));
            i += 2;
            continue;
        }
        toks.push(Tok::Punct(src[i..i + 1].to_string()));
        i += 1;
    }
    toks
}

fn mem_line(b: &[u8], i: usize) -> usize {
    b[i..].iter().position(|c| *c == b'\n').map(|p| i + p + 1).unwrap_or(b.len())
}

fn is_ident_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_'
}
fn is_ident_cont(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

fn scan_string(b: &[u8], start: usize, quote: u8) -> usize {
    let mut j = start + 1;
    while j < b.len() {
        if b[j] == b'\\' {
            j = (j + 2).min(b.len());
            continue;
        }
        if b[j] == quote {
            return j + 1;
        }
        if b[j] == b'\n' && quote != b'`' {
            return j;
        }
        j += 1;
    }
    b.len()
}

fn raw_end(b: &[u8], start: usize) -> Option<usize> {
    let mut j = start + 1;
    let mut hashes = 0usize;
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

fn pretty_braces(src: &str, lang: Lang) -> String {
    let toks = lex_code(src, lang);
    let mut out = String::new();
    let mut indent: i32 = 0;
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut at_indent = true;
    let space_before_paren = |w: &str| {
        matches!(
            w,
            "if" | "for"
                | "while"
                | "switch"
                | "catch"
                | "return"
                | "sizeof"
                | "with"
                | "elif"
                | "except"
        )
    };

    let newline = |out: &mut String, indent: i32, at_indent: &mut bool| {
        while out.ends_with(' ') {
            out.pop();
        }
        out.push('\n');
        for _ in 0..indent {
            out.push_str("    ");
        }
        *at_indent = true;
    };
    let rewind = |out: &mut String| {
        while out.ends_with(' ') {
            out.pop();
        }
    };

    let mut prev_word_kw = false;
    let mut idx = 0;
    while idx < toks.len() {
        match &toks[idx] {
            Tok::Raw(s) => {
                if !at_indent {
                    newline(&mut out, 0, &mut at_indent);
                } else {
                    rewind(&mut out);
                }
                out.push_str(s);
                newline(&mut out, indent, &mut at_indent);
                prev_word_kw = false;
            }
            Tok::Comment(s) => {
                let line = s.starts_with("//") || s.starts_with('#') || s.starts_with("--");
                if line {
                    if !at_indent {
                        out.push(' ');
                    }
                    out.push_str(s);
                    newline(&mut out, indent, &mut at_indent);
                } else {
                    if !at_indent {
                        out.push(' ');
                    }
                    out.push_str(s);
                    at_indent = false;
                }
                prev_word_kw = false;
            }
            Tok::Punct(p) if p == "{" => {
                if !at_indent {
                    out.push(' ');
                }
                out.push('{');
                indent += 1;
                newline(&mut out, indent, &mut at_indent);
                prev_word_kw = false;
            }
            Tok::Punct(p) if p == "}" => {
                indent = (indent - 1).max(0);
                if at_indent {
                    rewind(&mut out);
                    for _ in 0..indent {
                        out.push_str("    ");
                    }
                } else {
                    newline(&mut out, indent, &mut at_indent);
                }
                out.push('}');
                at_indent = false;
                let stick = toks.get(idx + 1).is_some_and(|t| match t {
                    Tok::Word(w)
                        if matches!(
                            w.as_str(),
                            "else" | "catch" | "finally" | "while" | "elif" | "except"
                        ) =>
                    {
                        true
                    }
                    Tok::Punct(p) if matches!(p.as_str(), ";" | "," | ")" | "]") => true,
                    _ => false,
                });
                if !stick {
                    newline(&mut out, indent, &mut at_indent);
                }
                prev_word_kw = false;
            }
            Tok::Punct(p) if p == ";" && paren == 0 && bracket == 0 => {
                out.push(';');
                newline(&mut out, indent, &mut at_indent);
                prev_word_kw = false;
            }
            Tok::Punct(p) if p == ";" => {
                out.push(';');
                at_indent = false;
                prev_word_kw = false;
            }
            Tok::Punct(p) if p == "," => {
                out.push_str(", ");
                at_indent = false;
                prev_word_kw = false;
            }
            Tok::Punct(p) if p == "(" => {
                if prev_word_kw && !out.ends_with(' ') && !at_indent {
                    out.push(' ');
                }
                out.push('(');
                paren += 1;
                at_indent = false;
                prev_word_kw = false;
            }
            Tok::Punct(p) if p == ")" => {
                paren = (paren - 1).max(0);
                out.push(')');
                at_indent = false;
                prev_word_kw = false;
            }
            Tok::Punct(p) if p == "[" => {
                bracket += 1;
                out.push('[');
                at_indent = false;
                prev_word_kw = false;
            }
            Tok::Punct(p) if p == "]" => {
                bracket = (bracket - 1).max(0);
                out.push(']');
                at_indent = false;
                prev_word_kw = false;
            }
            Tok::Punct(p) if p == ":" && lang == Lang::Css => {
                out.push_str(": ");
                at_indent = false;
                prev_word_kw = false;
            }
            Tok::Punct(p)
                if matches!(p.as_str(), "." | "::" | "->" | "++" | "--" | "?.") =>
            {
                out.push_str(p);
                at_indent = false;
                prev_word_kw = false;
            }
            Tok::Punct(p) => {
                let tight_after = matches!(p.as_str(), "(" | "[" | "{" | "." );
                let _ = tight_after;
                out.push_str(p);
                at_indent = false;
                prev_word_kw = false;
            }
            Tok::Word(w) => {
                let glue = matches!(w.as_str(), "else" | "catch" | "finally" | "while" | "elif" | "except")
                    && out.trim_end().ends_with('}');
                if glue {
                    out.push(' ');
                    out.push_str(w);
                } else {
                    if !at_indent && needs_space_before_word(&out) {
                        out.push(' ');
                    }
                    out.push_str(w);
                }
                at_indent = false;
                prev_word_kw = space_before_paren(w);
            }
            Tok::Str(s) => {
                if !at_indent && needs_space_before_word(&out) {
                    out.push(' ');
                }
                out.push_str(s);
                at_indent = false;
                prev_word_kw = false;
            }
        }
        idx += 1;
    }
    while out.ends_with(' ') || out.ends_with('\n') {
        // keep a single trailing newline
        if out.ends_with('\n') {
            let t = out.trim_end_matches('\n');
            let newlines = out.len() - t.len();
            if newlines > 1 {
                out.truncate(t.len() + 1);
            }
            break;
        }
        out.pop();
    }
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn needs_space_before_word(out: &str) -> bool {
    match out.chars().last() {
        Some(c) if c.is_ascii_alphanumeric() || c == '_' || c == ')' || c == ']' || c == '"' || c == '\'' || c == '`' => true,
        _ => false,
    }
}

fn pretty_python(src: &str) -> String {
    let mut out = String::new();
    let mut level: i32 = 0;
    for line in src.split_inclusive('\n') {
        let raw = line.trim_end_matches(['\n', '\r']);
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            out.push('\n');
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        let dedent = lower.starts_with("elif ")
            || lower == "elif:"
            || lower.starts_with("else:")
            || lower.starts_with("else ")
            || lower.starts_with("except")
            || lower.starts_with("finally");
        if dedent {
            level = (level - 1).max(0);
        }
        for _ in 0..level {
            out.push_str("    ");
        }
        out.push_str(trimmed);
        out.push('\n');
        if py_ends_colon(trimmed) {
            level += 1;
        }
    }
    out
}

fn py_ends_colon(line: &str) -> bool {
    let b = line.as_bytes();
    let mut i = 0;
    let mut quote: Option<u8> = None;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i = (i + 2).min(b.len());
                continue;
            }
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        if c == b'#' {
            break;
        }
        if c == b'"' || c == b'\'' {
            quote = Some(c);
            i += 1;
            continue;
        }
        i += 1;
    }
    let code = if let Some(h) = line.find('#') { &line[..h] } else { line };
    // crude: ignore colon inside strings by stripping strings
    let stripped = strip_quotes(code);
    stripped.trim_end().ends_with(':')
}

fn strip_quotes(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'"' || b[i] == b'\'' {
            let q = b[i];
            i += 1;
            while i < b.len() && b[i] != q {
                if b[i] == b'\\' {
                    i += 2;
                    continue;
                }
                i += 1;
            }
            i = (i + 1).min(b.len());
            out.push(' ');
            continue;
        }
        out.push(b[i] as char);
        i += 1;
    }
    out
}

fn pretty_sql(src: &str) -> String {
    let toks = lex_code(src, Lang::Sql);
    let mut out = String::new();
    let indent: i32 = 0;
    let mut at_indent = true;
    let break_before = |w: &str| {
        matches!(
            w,
            "from" | "where" | "group" | "order" | "having" | "limit" | "offset" | "values"
                | "set" | "union" | "join" | "left" | "right" | "inner" | "outer" | "on"
        )
    };
    let deep = |w: &str| matches!(w, "and" | "or" | "on");
    for tok in &toks {
        match tok {
            Tok::Comment(s) => {
                if !at_indent {
                    out.push(' ');
                }
                out.push_str(s);
                push_nl(&mut out, indent, &mut at_indent);
            }
            Tok::Word(w) => {
                let low = w.to_ascii_lowercase();
                if break_before(&low) && !at_indent {
                    let level = if deep(&low) { indent + 1 } else { indent };
                    push_nl(&mut out, level, &mut at_indent);
                } else if !at_indent && needs_space_before_word(&out) {
                    out.push(' ');
                }
                if is_sql_kw(&low) {
                    out.push_str(&low.to_ascii_uppercase());
                } else {
                    out.push_str(w);
                }
                at_indent = false;
            }
            Tok::Punct(p) if p == "," => {
                out.push(',');
                at_indent = false;
            }
            Tok::Punct(p) if p == "(" || p == ")" || p == "." || p == "*" => {
                out.push_str(p);
                at_indent = false;
            }
            Tok::Punct(p) => {
                if !at_indent && !out.ends_with(' ') && !out.ends_with('(') {
                    out.push(' ');
                }
                out.push_str(p);
                if !matches!(p.as_str(), "." | "(" ) {
                    out.push(' ');
                }
                at_indent = false;
            }
            Tok::Str(s) => {
                if !at_indent && needs_space_before_word(&out) {
                    out.push(' ');
                }
                out.push_str(s);
                at_indent = false;
            }
            Tok::Raw(_) => {}
        }
    }
    tidy_end(out)
}

fn is_sql_kw(low: &str) -> bool {
    matches!(
        low,
        "select" | "from" | "where" | "and" | "or" | "insert" | "into" | "values" | "update"
            | "set" | "delete" | "create" | "table" | "drop" | "alter" | "join" | "left"
            | "right" | "inner" | "outer" | "on" | "group" | "by" | "order" | "having"
            | "limit" | "offset" | "as" | "distinct" | "union" | "all" | "not" | "null"
            | "primary" | "key" | "in" | "is" | "like" | "between" | "case" | "when" | "then"
            | "else" | "end" | "asc" | "desc"
    )
}

fn push_nl(out: &mut String, indent: i32, at_indent: &mut bool) {
    while out.ends_with(' ') {
        out.pop();
    }
    out.push('\n');
    for _ in 0..indent.max(0) {
        out.push_str("    ");
    }
    *at_indent = true;
}

fn tidy_end(mut out: String) -> String {
    while out.ends_with(' ') {
        out.pop();
    }
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn pretty_abap(src: &str) -> String {
    let stmts = split_abap(src);
    let mut out = String::new();
    let mut level: i32 = 0;
    for stmt in stmts {
        let collapsed = collapse_abap_ws(&stmt);
        if collapsed.is_empty() {
            continue;
        }
        let pretty = upper_abap(&collapsed);
        let first = first_word(&pretty);
        let closer = is_abap_closer(&first);
        let mid = is_abap_mid(&first);
        if closer || mid {
            level = (level - 1).max(0);
        }
        for _ in 0..level {
            out.push_str("    ");
        }
        out.push_str(&pretty);
        if !pretty.ends_with('.') {
            out.push('.');
        }
        out.push('\n');
        let opener = is_abap_opener(&first, &pretty);
        if opener || mid {
            level += 1;
        }
    }
    out
}

fn split_abap(src: &str) -> Vec<String> {
    let b = src.as_bytes();
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut i = 0;
    let mut quote = false;
    while i < b.len() {
        let c = b[i];
        if c == b'\'' {
            quote = !quote;
            cur.push('\'');
            i += 1;
            continue;
        }
        if !quote && c == b'"' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if !quote && c == b'*' && (cur.trim().is_empty()) {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if !quote && c == b'.' {
            cur.push('.');
            let t = cur.trim().to_string();
            if !t.is_empty() {
                out.push(t);
            }
            cur.clear();
            i += 1;
            continue;
        }
        cur.push(c as char);
        i += 1;
    }
    let t = cur.trim().to_string();
    if !t.is_empty() {
        out.push(t);
    }
    out
}

fn collapse_abap_ws(s: &str) -> String {
    let mut out = String::new();
    let mut quote = false;
    let mut prev_space = false;
    for c in s.chars() {
        if c == '\'' {
            quote = !quote;
            out.push(c);
            prev_space = false;
            continue;
        }
        if !quote && c.is_whitespace() {
            if !prev_space && !out.is_empty() {
                out.push(' ');
                prev_space = true;
            }
            continue;
        }
        out.push(c);
        prev_space = false;
    }
    out.trim().to_string()
}

fn upper_abap(s: &str) -> String {
    let keys = crate::highlight::abap_word_set();
    let mut out = String::new();
    let mut quote = false;
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut String, keys: &[&str]| {
        if word.is_empty() {
            return;
        }
        let upper = word.to_ascii_uppercase();
        if keys.iter().any(|k| *k == upper) {
            out.push_str(&upper);
        } else {
            out.push_str(word);
        }
        word.clear();
    };
    for c in s.chars() {
        if c == '\'' {
            flush(&mut word, &mut out, keys);
            quote = !quote;
            out.push(c);
            continue;
        }
        if quote {
            out.push(c);
            continue;
        }
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            word.push(c);
        } else {
            flush(&mut word, &mut out, keys);
            out.push(c);
        }
    }
    flush(&mut word, &mut out, keys);
    out
}

fn first_word(s: &str) -> String {
    s.split(|c: char| c.is_whitespace() || c == '.' || c == ':')
        .find(|w| !w.is_empty())
        .unwrap_or("")
        .to_ascii_uppercase()
}

fn is_abap_closer(w: &str) -> bool {
    matches!(
        w,
        "ENDIF" | "ENDLOOP" | "ENDWHILE" | "ENDDO" | "ENDFORM" | "ENDFUNCTION" | "ENDMETHOD"
            | "ENDCLASS" | "ENDINTERFACE" | "ENDTRY" | "ENDCASE" | "ENDMODULE" | "ENDSELECT"
            | "ENDAT"
    )
}

fn is_abap_mid(w: &str) -> bool {
    matches!(w, "ELSE" | "ELSEIF" | "CATCH" | "CLEANUP" | "WHEN")
}

fn is_abap_opener(first: &str, stmt: &str) -> bool {
    if matches!(
        first,
        "IF" | "LOOP" | "WHILE" | "DO" | "FORM" | "FUNCTION" | "METHOD" | "CLASS"
            | "INTERFACE" | "TRY" | "CASE" | "MODULE" | "DEFINE"
    ) {
        return true;
    }
    if first == "SELECT" {
        let u = stmt.to_ascii_uppercase();
        return !u.contains(" INTO ") && !u.contains(" SINGLE") && !u.contains("APPENDING");
    }
    false
}

fn pretty_markup(src: &str, html: bool) -> Result<String, String> {
    const VOID: &[&str] = &[
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
        "source", "track", "wbr",
    ];
    let mut out = String::new();
    let b = src.as_bytes();
    let mut i = 0;
    let mut indent: i32 = 0;
    let mut saw = false;
    while i < b.len() {
        if b[i] == b'<' {
            saw = true;
            let rest = &src[i..];
            if rest.starts_with("<!--") {
                if let Some(end) = rest.find("-->") {
                    nl_at(&mut out, indent);
                    out.push_str(rest[..=end + 2].trim());
                    out.push('\n');
                    i += end + 3;
                    continue;
                }
            }
            let end_rel = rest.find('>').ok_or_else(|| "Unclosed tag, so nothing was changed.".to_string())?;
            let tag = &rest[..=end_rel];
            let name = tag_name(tag);
            let closing = tag.starts_with("</");
            let self_close = tag.ends_with("/>") || (html && VOID.iter().any(|v| name.eq_ignore_ascii_case(v)));
            if closing {
                indent = (indent - 1).max(0);
            }
            nl_at(&mut out, indent);
            out.push_str(tag.trim());
            out.push('\n');
            let raw = matches!(name.to_ascii_lowercase().as_str(), "script" | "style" | "pre");
            if !closing && !self_close {
                indent += 1;
                if raw {
                    let close = format!("</{name}>");
                    let after = i + tag.len();
                    if let Some(pos) = src[after..].to_ascii_lowercase().find(&close.to_ascii_lowercase()) {
                        let inner = src[after..after + pos].trim();
                        if !inner.is_empty() {
                            nl_at(&mut out, indent);
                            out.push_str(inner);
                            out.push('\n');
                        }
                        i = after + pos;
                        continue;
                    }
                }
            }
            i += tag.len();
            continue;
        }
        let rest = &src[i..];
        let end = rest.find('<').unwrap_or(rest.len());
        let text = rest[..end].trim();
        if !text.is_empty() {
            nl_at(&mut out, indent);
            out.push_str(text);
            out.push('\n');
        }
        i += end;
    }
    if !saw {
        return Err("Doesn't look like markup, so nothing was changed.".into());
    }
    Ok(out)
}

fn nl_at(out: &mut String, indent: i32) {
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    for _ in 0..indent {
        out.push_str("    ");
    }
}

fn tag_name(tag: &str) -> String {
    let t = tag.trim().trim_start_matches('<').trim_start_matches('/');
    t.chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == ':' || *c == '-')
        .collect()
}

fn pretty_md(src: &str) -> String {
    let mut out = String::new();
    let mut fence = false;
    let mut blank = 0;
    for line in src.split_inclusive('\n') {
        let raw = line.trim_end_matches(['\n', '\r']);
        let starts_fence = raw.trim_start().starts_with("```");
        if starts_fence {
            fence = !fence;
            if blank > 0 && !out.is_empty() {
                out.push('\n');
            }
            blank = 0;
            out.push_str(raw.trim_end());
            out.push('\n');
            continue;
        }
        if fence {
            out.push_str(raw.trim_end());
            out.push('\n');
            continue;
        }
        let t = raw.trim_end();
        if t.trim().is_empty() {
            blank += 1;
            if blank <= 1 {
                out.push('\n');
            }
            continue;
        }
        blank = 0;
        out.push_str(t);
        out.push('\n');
    }
    out
}
