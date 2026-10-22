pub fn utf16_len(s: &str) -> usize {
    s.chars().map(|c| c.len_utf16()).sum()
}

/// Byte index of a UTF-16 code-unit offset. Mid-surrogate offsets snap to a char boundary.
pub fn utf16_to_byte(s: &str, target: usize) -> usize {
    if target == 0 {
        return 0;
    }
    let mut u = 0usize;
    for (b, ch) in s.char_indices() {
        if u >= target {
            return b;
        }
        u += ch.len_utf16();
    }
    s.len()
}

pub fn slice_utf16(s: &str, start: usize, end: usize) -> String {
    let (start, end) = if start <= end { (start, end) } else { (end, start) };
    let b0 = utf16_to_byte(s, start);
    let b1 = utf16_to_byte(s, end);
    s[b0..b1].to_string()
}

pub fn splice_utf16(s: &mut String, start: usize, end: usize, insert: &str) -> String {
    let (start, end) = if start <= end { (start, end) } else { (end, start) };
    let b0 = utf16_to_byte(s, start);
    let b1 = utf16_to_byte(s, end);
    let deleted = s[b0..b1].to_string();
    s.replace_range(b0..b1, insert);
    deleted
}

/// 1-based line and column. Column counts Unicode scalars, not UTF-16 units.
pub fn line_col(s: &str, utf16_pos: usize) -> (u32, u32) {
    let mut line = 1u32;
    let mut col = 1u32;
    let mut seen = 0usize;
    for ch in s.chars() {
        if seen >= utf16_pos {
            break;
        }
        let n = ch.len_utf16();
        if seen + n > utf16_pos {
            break;
        }
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
        seen += n;
    }
    (line, col)
}

pub fn offset_of_line(s: &str, line: u32) -> usize {
    if line <= 1 {
        return 0;
    }
    let mut cur = 1u32;
    let mut u = 0usize;
    for ch in s.chars() {
        if cur == line {
            return u;
        }
        u += ch.len_utf16();
        if ch == '\n' {
            cur += 1;
        }
    }
    u
}

pub fn count_lines(s: &str) -> u32 {
    1 + s.chars().filter(|c| *c == '\n').count() as u32
}
