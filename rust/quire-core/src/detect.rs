use crate::lang::Lang;

/// Conservative sniff. `None` means "leave it alone" — a letter must not become JSON.
pub fn detect(text: &str) -> Option<Lang> {
    let sample: String = text.chars().take(12_000).collect();
    let trimmed = sample.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if looks_json(trimmed) {
        return Some(Lang::Json);
    }
    if looks_abap(&lower) {
        return Some(Lang::Abap);
    }
    if looks_html(&lower) {
        return Some(Lang::Html);
    }
    if looks_xml(trimmed, &lower) {
        return Some(Lang::Xml);
    }
    if looks_python(&lower) {
        return Some(Lang::Python);
    }
    if looks_java(&lower) {
        return Some(Lang::Java);
    }
    if looks_rust(&lower) {
        return Some(Lang::Rust);
    }
    if looks_cpp(&lower) {
        return Some(Lang::Cpp);
    }
    if looks_c(&lower) {
        return Some(Lang::C);
    }
    if looks_js(&lower) {
        return Some(Lang::Js);
    }
    if looks_css(&lower) {
        return Some(Lang::Css);
    }
    if looks_sql(&lower) {
        return Some(Lang::Sql);
    }
    if looks_md(trimmed) {
        return Some(Lang::Md);
    }
    None
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
        "call function",
        "move-corresponding",
        "function-pool",
        "start-of-selection",
        "field-symbols",
    ];
    if STRONG.iter().any(|k| lower.contains(k)) {
        return true;
    }
    lower.lines().any(|line| {
        let s = line.trim_start();
        s.starts_with("data:")
            || s.starts_with("types:")
            || (s.starts_with("report ") && s.trim_end().ends_with('.'))
    })
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
        s.starts_with("def ")
            || s.starts_with("elif ")
            || s.starts_with("async def")
            || s.starts_with("#!") && s.contains("python")
    })
}

fn looks_java(lower: &str) -> bool {
    has_word(lower, "package") && lower.contains(';')
        || lower.contains("public class")
        || lower.contains("import java.")
        || lower.contains("system.out")
        || lower.contains("public static void main")
}

fn looks_rust(lower: &str) -> bool {
    lower.contains("println!")
        || lower.contains("fn ")
        || has_word(lower, "impl")
        || lower.contains("let mut")
        || (has_word(lower, "pub") && (lower.contains("struct") || lower.contains("fn ") || lower.contains("enum")))
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
        || has_word(lower, "printf")
        || lower.contains("int main")
}

fn looks_js(lower: &str) -> bool {
    lower.contains("=>")
        || has_word(lower, "function")
        || has_word(lower, "const")
        || has_word(lower, "let")
        || lower.contains("console.")
        || has_word(lower, "import")
        || has_word(lower, "export")
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

fn looks_sql(lower: &str) -> bool {
    (has_word(lower, "select") && has_word(lower, "from"))
        || lower.contains("insert into")
        || lower.contains("create table")
        || (has_word(lower, "update") && has_word(lower, "set"))
}

fn looks_md(raw: &str) -> bool {
    let mut headings = 0;
    let mut fence = false;
    for line in raw.lines() {
        let t = line.trim_start();
        if t.starts_with("```") {
            fence = true;
        }
        if t.starts_with("# ") || t.starts_with("## ") || t.starts_with("### ") {
            headings += 1;
        }
    }
    fence || headings >= 2
}

fn has_word(hay: &str, word: &str) -> bool {
    hay.match_indices(word).any(|(i, _)| {
        let before_ok = i == 0 || !hay.as_bytes()[i - 1].is_ascii_alphanumeric();
        let after = i + word.len();
        let after_ok = after >= hay.len() || !hay.as_bytes()[after].is_ascii_alphanumeric();
        before_ok && after_ok
    })
}
