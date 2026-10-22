#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Windows1252,
}

impl Encoding {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Utf8 => "utf-8",
            Self::Utf8Bom => "utf-8-bom",
            Self::Utf16Le => "utf-16le",
            Self::Utf16Be => "utf-16be",
            Self::Windows1252 => "windows-1252",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Utf8 => "UTF-8",
            Self::Utf8Bom => "UTF-8 BOM",
            Self::Utf16Le => "UTF-16 LE",
            Self::Utf16Be => "UTF-16 BE",
            Self::Windows1252 => "Windows-1252",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "utf-8" | "utf8" => Some(Self::Utf8),
            "utf-8-bom" | "utf8-bom" => Some(Self::Utf8Bom),
            "utf-16le" | "utf-16" | "utf16le" => Some(Self::Utf16Le),
            "utf-16be" | "utf16be" => Some(Self::Utf16Be),
            "windows-1252" | "cp1252" | "ansi" => Some(Self::Windows1252),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Eol {
    Lf,
    Crlf,
    Mixed,
}

impl Eol {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lf => "lf",
            Self::Crlf => "crlf",
            Self::Mixed => "mixed",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Lf => "LF",
            Self::Crlf => "CRLF",
            Self::Mixed => "Mixed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "lf" | "unix" => Some(Self::Lf),
            "crlf" | "windows" => Some(Self::Crlf),
            "mixed" => Some(Self::Mixed),
            _ => None,
        }
    }
}

pub fn detect_eol(s: &str) -> Eol {
    let b = s.as_bytes();
    let mut crlf = 0i32;
    let mut lf = 0i32;
    let mut cr = 0i32;
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\r' {
            if i + 1 < b.len() && b[i + 1] == b'\n' {
                crlf += 1;
                i += 2;
            } else {
                cr += 1;
                i += 1;
            }
        } else if b[i] == b'\n' {
            lf += 1;
            i += 1;
        } else {
            i += 1;
        }
    }
    let kinds = (crlf > 0) as u8 + (lf > 0) as u8 + (cr > 0) as u8;
    if kinds > 1 {
        Eol::Mixed
    } else if crlf > 0 || cr > 0 {
        Eol::Crlf
    } else {
        Eol::Lf
    }
}

pub fn normalize_eol(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    out
}

pub fn apply_eol(s: &str, eol: Eol) -> String {
    if eol != Eol::Crlf {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        if ch == '\n' {
            out.push_str("\r\n");
        } else {
            out.push(ch);
        }
    }
    out
}

pub fn decode(bytes: &[u8]) -> (String, Encoding, Eol) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let s = String::from_utf8_lossy(&bytes[3..]).into_owned();
        let eol = detect_eol(&s);
        return (normalize_eol(&s), Encoding::Utf8Bom, eol);
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let s = decode_utf16(&bytes[2..], true);
        let eol = detect_eol(&s);
        return (normalize_eol(&s), Encoding::Utf16Le, eol);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let s = decode_utf16(&bytes[2..], false);
        let eol = detect_eol(&s);
        return (normalize_eol(&s), Encoding::Utf16Be, eol);
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        let eol = detect_eol(s);
        return (normalize_eol(s), Encoding::Utf8, eol);
    }
    let s = decode_1252(bytes);
    let eol = detect_eol(&s);
    (normalize_eol(&s), Encoding::Windows1252, eol)
}

pub fn encode(text: &str, encoding: Encoding, eol: Eol) -> Result<Vec<u8>, String> {
    let with_eol = apply_eol(text, eol);
    match encoding {
        Encoding::Utf8 => Ok(with_eol.into_bytes()),
        Encoding::Utf8Bom => {
            let mut v = vec![0xEF, 0xBB, 0xBF];
            v.extend(with_eol.into_bytes());
            Ok(v)
        }
        Encoding::Utf16Le => Ok(encode_utf16(&with_eol, true)),
        Encoding::Utf16Be => Ok(encode_utf16(&with_eol, false)),
        Encoding::Windows1252 => encode_1252(&with_eol),
    }
}

fn decode_utf16(bytes: &[u8], le: bool) -> String {
    let mut units = Vec::with_capacity(bytes.len() / 2);
    let mut i = 0;
    while i + 1 < bytes.len() {
        let u = if le {
            u16::from_le_bytes([bytes[i], bytes[i + 1]])
        } else {
            u16::from_be_bytes([bytes[i], bytes[i + 1]])
        };
        units.push(u);
        i += 2;
    }
    String::from_utf16_lossy(&units)
}

fn encode_utf16(s: &str, le: bool) -> Vec<u8> {
    let mut v = if le { vec![0xFF, 0xFE] } else { vec![0xFE, 0xFF] };
    for u in s.encode_utf16() {
        let b = if le { u.to_le_bytes() } else { u.to_be_bytes() };
        v.extend_from_slice(&b);
    }
    v
}

fn decode_1252(bytes: &[u8]) -> String {
    bytes.iter().map(|b| cp1252_to_char(*b)).collect()
}

fn cp1252_to_char(b: u8) -> char {
    match b {
        0x80 => '\u{20AC}',
        0x82 => '\u{201A}',
        0x83 => '\u{0192}',
        0x84 => '\u{201E}',
        0x85 => '\u{2026}',
        0x86 => '\u{2020}',
        0x87 => '\u{2021}',
        0x88 => '\u{02C6}',
        0x89 => '\u{2030}',
        0x8A => '\u{0160}',
        0x8B => '\u{2039}',
        0x8C => '\u{0152}',
        0x8E => '\u{017D}',
        0x91 => '\u{2018}',
        0x92 => '\u{2019}',
        0x93 => '\u{201C}',
        0x94 => '\u{201D}',
        0x95 => '\u{2022}',
        0x96 => '\u{2013}',
        0x97 => '\u{2014}',
        0x98 => '\u{02DC}',
        0x99 => '\u{2122}',
        0x9A => '\u{0161}',
        0x9B => '\u{203A}',
        0x9C => '\u{0153}',
        0x9E => '\u{017E}',
        0x9F => '\u{0178}',
        _ => b as char,
    }
}

fn char_to_1252(ch: char) -> Option<u8> {
    let special = match ch {
        '\u{20AC}' => Some(0x80),
        '\u{201A}' => Some(0x82),
        '\u{0192}' => Some(0x83),
        '\u{201E}' => Some(0x84),
        '\u{2026}' => Some(0x85),
        '\u{2020}' => Some(0x86),
        '\u{2021}' => Some(0x87),
        '\u{02C6}' => Some(0x88),
        '\u{2030}' => Some(0x89),
        '\u{0160}' => Some(0x8A),
        '\u{2039}' => Some(0x8B),
        '\u{0152}' => Some(0x8C),
        '\u{017D}' => Some(0x8E),
        '\u{2018}' => Some(0x91),
        '\u{2019}' => Some(0x92),
        '\u{201C}' => Some(0x93),
        '\u{201D}' => Some(0x94),
        '\u{2022}' => Some(0x95),
        '\u{2013}' => Some(0x96),
        '\u{2014}' => Some(0x97),
        '\u{02DC}' => Some(0x98),
        '\u{2122}' => Some(0x99),
        '\u{0161}' => Some(0x9A),
        '\u{203A}' => Some(0x9B),
        '\u{0153}' => Some(0x9C),
        '\u{017E}' => Some(0x9E),
        '\u{0178}' => Some(0x9F),
        '\u{0081}' => Some(0x81),
        '\u{008D}' => Some(0x8D),
        '\u{008F}' => Some(0x8F),
        '\u{0090}' => Some(0x90),
        '\u{009D}' => Some(0x9D),
        _ => None,
    };
    if let Some(b) = special {
        return Some(b);
    }
    let u = ch as u32;
    if u <= 0x7F || (0xA0..=0xFF).contains(&u) {
        return Some(u as u8);
    }
    None
}

fn encode_1252(s: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(s.len());
    for ch in s.chars() {
        match char_to_1252(ch) {
            Some(b) => out.push(b),
            None => {
                return Err("Those characters don't fit in Windows-1252.".into());
            }
        }
    }
    Ok(out)
}
