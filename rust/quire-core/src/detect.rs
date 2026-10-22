use crate::lang::Lang;

/// Conservative sniff. `None` means "leave it alone" — a letter must not become JSON.
///
/// The rule this module exists to protect: **English prose never becomes code.**
/// A note that merely contains the words "select", "from", "function", "import"
/// or "delete" is still a letter. A language is only claimed when the text also
/// has the shape of code.
pub fn detect(text: &str) -> Option<Lang> {
    let sample: String = text.chars().take(12_000).collect();
    let trimmed = sample.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();

    // Both of these are unambiguous or structural enough to skip the shape gate.
    if looks_json(trimmed) {
        return Some(Lang::Json);
    }
    if looks_abap(&lower) {
        return Some(Lang::Abap);
    }

    if let Some(lang) = detect_code(trimmed, &lower) {
        return Some(lang);
    }
    // Markdown is text-shaped, so it is judged last and on its own terms.
    if looks_md(trimmed) {
        return Some(Lang::Md);
    }
    None
}

/// Programming languages only. Everything here requires machine punctuation
/// first, so a sentence can never reach a keyword check on its own.
fn detect_code(raw: &str, lower: &str) -> Option<Lang> {
    if !has_code_shape(raw) {
        return None;
    }
    if looks_html(lower) {
        return Some(Lang::Html);
    }
    if looks_xml(raw, lower) {
        return Some(Lang::Xml);
    }
    if looks_python(lower) {
        return Some(Lang::Python);
    }
    if looks_java(lower) {
        return Some(Lang::Java);
    }
    if looks_rust(lower) {
        return Some(Lang::Rust);
    }
    if looks_cpp(lower) {
        return Some(Lang::Cpp);
    }
    if looks_c(lower) {
        return Some(Lang::C);
    }
    if looks_js(lower) {
        return Some(Lang::Js);
    }
    if looks_css(lower) {
        return Some(Lang::Css);
    }
    if looks_sql(raw, lower) {
        return Some(Lang::Sql);
    }
    None
}

/// Machine punctuation that ordinary prose does not carry. Parentheses and
/// commas are deliberately absent: a sentence may contain "(see below)".
fn has_code_shape(text: &str) -> bool {
    text.chars().any(|c| {
        matches!(
            c,
            '{' | '}' | '[' | ']' | '=' | '<' | '>' | ';' | ':' | '/' | '\\' | '|' | '#' | '`'
        )
    }) || text.contains("=>")
}

fn looks_json(t: &str) -> bool {
    let t = t.trim_start();
    if !(t.starts_with('{') || t.starts_with('[')) {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(t).is_ok()
}

fn looks_abap(lower: &str) -> bool {
    const STRONG: &[&str] = &[
        "endmethod",
        "endform",
        "endfunction",
        "endclass",
        "sy-subrc",
        "move-corresponding",
        "function-pool",
        "start-of-selection",
        "field-symbols",
    ];
    if STRONG.iter().any(|k| lower.contains(k)) {
        return true;
    }
    let declarations = lower.lines().any(|line| {
        let s = line.trim_start();
        s.starts_with("data:") || s.starts_with("types:")
    });
    if declarations {
        return true;
    }
    // `REPORT zdemo.` alone is also how an English sentence can start, so a
    // header only counts when another statement line agrees.
    let mut lines = lower.lines().map(str::trim).filter(|l| !l.is_empty());
    let Some(first) = lines.next() else {
        return false;
    };
    let header = (first.starts_with("report ") || first.starts_with("program "))
        && first.ends_with('.');
    let body = lower.lines().any(|line| {
        let s = line.trim_start();
        (s.starts_with("write ") || s.starts_with("write:") || s.starts_with("write/"))
            && s.trim_end().ends_with('.')
    });
    header && body
}

fn looks_html(lower: &str) -> bool {
    lower.contains("<!doctype html")
        || lower.contains("<html")
        || lower.contains("<body")
        || lower.contains("<head")
        || lower.contains("<div")
        || lower.contains("<span")
        || lower.contains("<p>")
        || lower.contains("<p ")
        || lower.contains("<table")
        || lower.contains("<section")
}

fn looks_xml(raw: &str, lower: &str) -> bool {
    let t = raw.trim_start();
    (t.starts_with("<?xml") || (t.starts_with('<') && lower.contains("</")))
        && !looks_html(lower)
}

fn looks_python(lower: &str) -> bool {
    lower.lines().any(|line| {
        let s = line.trim_start();
        (s.starts_with("def ") || s.starts_with("elif ") || s.starts_with("async def"))
            && s.trim_end().ends_with(':')
            || (s.starts_with("#!") && s.contains("python"))
    })
}

fn looks_java(lower: &str) -> bool {
    lower.contains("public class")
        || lower.contains("import java.")
        || lower.contains("system.out")
        || lower.contains("public static void main")
        || lower.lines().any(|line| {
            let s = line.trim_start();
            s.starts_with("package ") && s.trim_end().ends_with(';')
        })
}

fn looks_rust(lower: &str) -> bool {
    lower.contains("println!")
        || lower.contains("fn ")
        || lower.contains("let mut")
        || lower.contains("impl ") && lower.contains('{')
        || (has_word(lower, "pub")
            && (lower.contains("struct") || lower.contains("fn ") || lower.contains("enum")))
        || (lower.contains("::") && (has_word(lower, "use") || has_word(lower, "mod")))
}

fn looks_cpp(lower: &str) -> bool {
    lower.contains("#include <iostream>")
        || lower.contains("std::")
        || lower.contains("nullptr")
        || lower.contains("template<")
        || lower.contains("template <")
        || (lower.contains("cout") && lower.contains("#include"))
}

fn looks_c(lower: &str) -> bool {
    lower.contains("#include")
        || lower.contains("#define")
        || has_word(lower, "printf") && lower.contains('(')
        || lower.contains("int main")
}

/// English words that are also JavaScript keywords are not signals. Two
/// independent pieces of syntax are required.
fn looks_js(lower: &str) -> bool {
    let binding = has_word(lower, "const") || has_word(lower, "let") || has_word(lower, "var");
    let arrow = lower.contains("=>");
    let member_call = lower.contains("console.") || lower.contains(".then(") || lower.contains(".map(");
    let block = lower.contains('{') && lower.contains('}');
    let terminated = lower.contains(';');
    let import_form = (has_word(lower, "import") || has_word(lower, "export"))
        && (lower.contains(" from ") || block || terminated);
    let declaration = has_word(lower, "function")
        && lower.contains('(')
        && lower.contains(')')
        && (block || arrow);

    [binding, arrow, member_call, block && terminated, import_form, declaration]
        .iter()
        .filter(|signal| **signal)
        .count()
        >= 2
}

fn looks_css(lower: &str) -> bool {
    if !lower.contains('{') || !lower.contains(':') || !lower.contains('}') {
        return false;
    }
    if looks_js(lower) || lower.contains("#include") || has_word(lower, "function") {
        return false;
    }
    const PROPS: &[&str] = &[
        "color", "margin", "padding", "display", "font-", "background", "border", "width",
        "height", "flex",
    ];
    PROPS.iter().any(|p| lower.contains(p))
}

/// `select … from` is a perfectly ordinary English clause, so the statement must
/// also start a line (or be upper-cased) or carry another SQL clause.
fn looks_sql(raw: &str, lower: &str) -> bool {
    if lower.contains("insert into") || lower.contains("create table") {
        return true;
    }
    let select_from = has_word(lower, "select") && has_word(lower, "from");
    if !select_from {
        return has_word(lower, "update") && has_word(lower, "set") && lower.contains('=');
    }
    let leading_keyword = lower.lines().any(|line| {
        let s = line.trim_start();
        s.starts_with("select ") || s.starts_with("select\n") || s.starts_with("select *")
    });
    let upper = raw.contains("SELECT ") || raw.trim_start().starts_with("SELECT ");
    let clause = [" where ", " join ", " group by ", " order by ", " values", " limit ", " into "]
        .iter()
        .any(|c| lower.contains(c));
    leading_keyword || upper || clause
}

fn looks_md(raw: &str) -> bool {
    let mut headings = 0;
    let mut fence = false;
    let mut lists = 0;
    let mut ink = false;
    for line in raw.lines() {
        let t = line.trim_start();
        if t.starts_with("```") {
            fence = true;
        }
        if t.starts_with("# ") || t.starts_with("## ") || t.starts_with("### ") {
            headings += 1;
        }
        if t.starts_with("- ") || t.starts_with("* ") || t.starts_with("1. ") {
            lists += 1;
        }
        if t.starts_with('>') || (t.contains("**") && t.matches("**").count() >= 2) || t.contains("](") {
            ink = true;
        }
    }
    // A short note with one heading and one other Markdown habit is still Markdown.
    fence || headings >= 2 || (headings >= 1 && (lists >= 2 || ink))
}

fn has_word(hay: &str, word: &str) -> bool {
    hay.match_indices(word).any(|(i, _)| {
        let before_ok = i == 0 || !hay.as_bytes()[i - 1].is_ascii_alphanumeric();
        let after = i + word.len();
        let after_ok = after >= hay.len() || !hay.as_bytes()[after].is_ascii_alphanumeric();
        before_ok && after_ok
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prose(text: &str) {
        assert_eq!(detect(text), None, "prose was detected as code: {text:?}");
    }

    #[test]
    fn english_sentences_stay_plain() {
        prose("Please select the best option from the list.");
        prose("The function returns the value you asked for.");
        prose("We import the data every Monday and delete the old rows.");
        prose("Return the form to the front desk, then delete the old copy.");
        prose("Report the issue to the team.");
        prose("Note: select the best option from the list.");
        prose("Call function X when the batch is ready.");
        prose("Dear Ana, thank you for the letter about the house.");
    }

    #[test]
    fn real_code_is_still_detected() {
        assert_eq!(detect("SELECT id FROM users WHERE id = 1"), Some(Lang::Sql));
        assert_eq!(detect("select id from users;"), Some(Lang::Sql));
        assert_eq!(detect("{\"a\":1}"), Some(Lang::Json));
        assert_eq!(detect("public class A {\n  void main() {}\n}"), Some(Lang::Java));
        assert_eq!(detect("REPORT zdemo.\nWRITE 'x'.\n"), Some(Lang::Abap));
        assert_eq!(detect("#include <stdio.h>\nint main(){return 0;}\n"), Some(Lang::C));
        assert_eq!(detect("fn main() {\n    let mut x = 1;\n}\n"), Some(Lang::Rust));
        assert_eq!(detect("def greet():\n    return 1\n"), Some(Lang::Python));
        assert_eq!(
            detect("const rows = items.map((item) => item.id);\n"),
            Some(Lang::Js)
        );
        assert_eq!(detect("import { readFile } from \"node:fs\";\n"), Some(Lang::Js));
        assert_eq!(detect("div.card { color: red; }\n"), Some(Lang::Css));
    }

    #[test]
    fn short_markdown_is_detected() {
        assert_eq!(detect("# Title\n\n- one\n- two\n"), Some(Lang::Md));
        assert_eq!(detect("## A\n\n**bold** text\n"), Some(Lang::Md));
    }
}
