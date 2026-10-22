#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    Plain,
    Json,
    Xml,
    Html,
    Css,
    Js,
    Sql,
    Md,
    Rust,
    Java,
    C,
    Cpp,
    Python,
    Abap,
}

impl Lang {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Plain => "plain",
            Self::Json => "json",
            Self::Xml => "xml",
            Self::Html => "html",
            Self::Css => "css",
            Self::Js => "javascript",
            Self::Sql => "sql",
            Self::Md => "markdown",
            Self::Rust => "rust",
            Self::Java => "java",
            Self::C => "c",
            Self::Cpp => "cpp",
            Self::Python => "python",
            Self::Abap => "abap",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Plain => "Plain text",
            Self::Json => "JSON",
            Self::Xml => "XML",
            Self::Html => "HTML",
            Self::Css => "CSS",
            Self::Js => "JavaScript",
            Self::Sql => "SQL",
            Self::Md => "Markdown",
            Self::Rust => "Rust",
            Self::Java => "Java",
            Self::C => "C",
            Self::Cpp => "C++",
            Self::Python => "Python",
            Self::Abap => "ABAP",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "plain" | "text" | "txt" => Some(Self::Plain),
            "json" => Some(Self::Json),
            "xml" => Some(Self::Xml),
            "html" | "htm" => Some(Self::Html),
            "css" => Some(Self::Css),
            "javascript" | "js" | "typescript" | "ts" | "jsx" | "tsx" => Some(Self::Js),
            "sql" => Some(Self::Sql),
            "markdown" | "md" => Some(Self::Md),
            "rust" | "rs" => Some(Self::Rust),
            "java" => Some(Self::Java),
            "c" | "h" => Some(Self::C),
            "cpp" | "c++" | "cc" | "hpp" | "cxx" => Some(Self::Cpp),
            "python" | "py" => Some(Self::Python),
            "abap" => Some(Self::Abap),
            _ => None,
        }
    }

    pub fn from_filename(name: &str) -> Option<Self> {
        let ext = name.rsplit('.').next()?.to_ascii_lowercase();
        match ext.as_str() {
            "json" => Some(Self::Json),
            "xml" => Some(Self::Xml),
            "html" | "htm" => Some(Self::Html),
            "css" => Some(Self::Css),
            "js" | "mjs" | "cjs" | "jsx" | "ts" | "tsx" => Some(Self::Js),
            "sql" => Some(Self::Sql),
            "md" | "markdown" => Some(Self::Md),
            "rs" => Some(Self::Rust),
            "java" => Some(Self::Java),
            "c" | "h" => Some(Self::C),
            "cpp" | "cc" | "cxx" | "hpp" | "hh" => Some(Self::Cpp),
            "py" => Some(Self::Python),
            "abap" => Some(Self::Abap),
            "txt" => Some(Self::Plain),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LangMode {
    Auto,
    Fixed(Lang),
}

impl LangMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Fixed(lang) => lang.as_str(),
        }
    }

    pub fn parse(s: &str) -> Self {
        if s.eq_ignore_ascii_case("auto") || s.is_empty() {
            Self::Auto
        } else {
            Lang::parse(s).map(Self::Fixed).unwrap_or(Self::Auto)
        }
    }
}
