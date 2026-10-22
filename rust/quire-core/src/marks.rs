//! Inline styles for text blocks: sorted, non-overlapping runs over UTF-16 offsets.

pub const BOLD: u8 = 1;
pub const ITALIC: u8 = 2;
pub const UNDERLINE: u8 = 4;
pub const STRIKE: u8 = 8;
pub const FLAG_MASK: u8 = BOLD | ITALIC | UNDERLINE | STRIKE;
pub const MAX_INK: u8 = 15;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Style {
    pub flags: u8,
    pub ink: u8,
    pub hl: u8,
}

impl Style {
    pub fn is_plain(&self) -> bool {
        self.flags == 0 && self.ink == 0 && self.hl == 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Run {
    pub start: u32,
    pub end: u32,
    pub style: Style,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StyleChange {
    Flag(u8, bool),
    Ink(u8),
    Highlight(u8),
    Clear,
}

impl StyleChange {
    pub fn parse(kind: &str, value: u32) -> Option<Self> {
        let on = value != 0;
        let small = value.min(MAX_INK as u32) as u8;
        Some(match kind {
            "bold" => Self::Flag(BOLD, on),
            "italic" => Self::Flag(ITALIC, on),
            "underline" => Self::Flag(UNDERLINE, on),
            "strike" => Self::Flag(STRIKE, on),
            "ink" => Self::Ink(small),
            "hl" => Self::Highlight(small),
            "clear" => Self::Clear,
            _ => return None,
        })
    }

    fn apply(self, mut style: Style) -> Style {
        match self {
            Self::Flag(bit, true) => style.flags |= bit,
            Self::Flag(bit, false) => style.flags &= !bit,
            Self::Ink(ink) => style.ink = ink,
            Self::Highlight(hl) => style.hl = hl,
            Self::Clear => style = Style::default(),
        }
        style
    }
}

/// Merges touching runs of equal style and drops empty or plain ones.
pub fn normalize(runs: Vec<Run>) -> Vec<Run> {
    let mut sorted: Vec<Run> = runs.into_iter().filter(|r| r.end > r.start && !r.style.is_plain()).collect();
    sorted.sort_by_key(|r| (r.start, r.end));
    let mut out: Vec<Run> = Vec::with_capacity(sorted.len());
    for run in sorted {
        if let Some(last) = out.last_mut() {
            if last.end == run.start && last.style == run.style {
                last.end = run.end;
                continue;
            }
            if run.start < last.end {
                let last_end = last.end;
                // Overlap should not happen; keep the earlier run's claim.
                if run.end <= last.end {
                    continue;
                }
                out.push(Run { start: last_end, ..run });
                continue;
            }
        }
        out.push(run);
    }
    out
}

/// Applies a text splice (`start..end` replaced by `inserted` UTF-16 units) to the runs.
/// Inserted text continues the style of the character just before it, or of a selection it replaced.
pub fn shift(runs: &[Run], start: u32, end: u32, inserted: u32) -> Vec<Run> {
    let removed = end.saturating_sub(start);
    let map = |p: u32| {
        if p <= start {
            p
        } else if p >= end {
            p - removed
        } else {
            start
        }
    };
    let mapped: Vec<Run> = runs
        .iter()
        .map(|r| Run { start: map(r.start), end: map(r.end), style: r.style })
        .collect();
    let mut heir: Option<usize> = None;
    if inserted > 0 {
        heir = mapped.iter().position(|r| r.start < start && r.end >= start);
        if heir.is_none() && removed > 0 {
            heir = runs.iter().position(|r| r.start <= start && r.end >= end && r.end > r.start);
        }
        if heir.is_none() && start == 0 {
            heir = mapped.iter().position(|r| r.start == 0 && r.end > 0);
        }
    }
    let mut out = Vec::with_capacity(mapped.len());
    for (i, mut r) in mapped.into_iter().enumerate() {
        if Some(i) == heir {
            if r.start > start {
                r.start = start;
            }
            r.end += inserted;
        } else if inserted > 0 {
            if r.start >= start {
                r.start += inserted;
            }
            if r.end > start || (r.end == start && r.start > start) {
                r.end += inserted;
            }
        }
        out.push(r);
    }
    normalize(out)
}

/// Returns new runs with `change` applied over `start..end`.
pub fn restyle(runs: &[Run], start: u32, end: u32, change: StyleChange) -> Vec<Run> {
    if start >= end {
        return runs.to_vec();
    }
    let mut points: Vec<u32> = Vec::with_capacity(runs.len() * 2 + 2);
    points.push(start);
    points.push(end);
    for r in runs {
        points.push(r.start);
        points.push(r.end);
    }
    points.sort_unstable();
    points.dedup();
    let mut out = Vec::with_capacity(points.len());
    for w in points.windows(2) {
        let (a, b) = (w[0], w[1]);
        let mut style = runs
            .iter()
            .find(|r| r.start <= a && r.end >= b)
            .map(|r| r.style)
            .unwrap_or_default();
        if a >= start && b <= end {
            style = change.apply(style);
        }
        out.push(Run { start: a, end: b, style });
    }
    normalize(out)
}

/// Splits runs at `at`, returning (left, right) with right rebased to 0.
pub fn split(runs: &[Run], at: u32) -> (Vec<Run>, Vec<Run>) {
    let mut left = Vec::new();
    let mut right = Vec::new();
    for r in runs {
        if r.start < at {
            left.push(Run { start: r.start, end: r.end.min(at), style: r.style });
        }
        if r.end > at {
            right.push(Run { start: r.start.max(at) - at, end: r.end - at, style: r.style });
        }
    }
    (normalize(left), normalize(right))
}

/// Appends `tail` runs, offset by `offset`, after `head`.
pub fn join(head: &[Run], tail: &[Run], offset: u32) -> Vec<Run> {
    let mut out = head.to_vec();
    out.extend(tail.iter().map(|r| Run { start: r.start + offset, end: r.end + offset, style: r.style }));
    normalize(out)
}

/// Keeps runs inside `0..len`.
pub fn clamp(runs: Vec<Run>, len: u32) -> Vec<Run> {
    normalize(
        runs.into_iter()
            .map(|r| Run { start: r.start.min(len), end: r.end.min(len), style: r.style })
            .collect(),
    )
}

pub fn flatten(runs: &[Run]) -> Vec<u32> {
    let mut out = Vec::with_capacity(runs.len() * 5);
    for r in runs {
        out.extend_from_slice(&[r.start, r.end, r.style.flags as u32, r.style.ink as u32, r.style.hl as u32]);
    }
    out
}

pub fn unflatten(flat: &[u32]) -> Vec<Run> {
    flat.chunks_exact(5)
        .map(|c| Run {
            start: c[0],
            end: c[1],
            style: Style {
                flags: (c[2] as u8) & FLAG_MASK,
                ink: c[3].min(MAX_INK as u32) as u8,
                hl: c[4].min(MAX_INK as u32) as u8,
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bold(start: u32, end: u32) -> Run {
        Run { start, end, style: Style { flags: BOLD, ink: 0, hl: 0 } }
    }

    #[test]
    fn restyle_merges_and_clears() {
        let runs = restyle(&[], 2, 5, StyleChange::Flag(BOLD, true));
        assert_eq!(runs, vec![bold(2, 5)]);
        let runs = restyle(&runs, 4, 8, StyleChange::Flag(BOLD, true));
        assert_eq!(runs, vec![bold(2, 8)]);
        let runs = restyle(&runs, 3, 4, StyleChange::Flag(BOLD, false));
        assert_eq!(runs, vec![bold(2, 3), bold(4, 8)]);
        let runs = restyle(&runs, 0, 10, StyleChange::Clear);
        assert!(runs.is_empty());
    }

    #[test]
    fn restyle_layers_ink_over_bold() {
        let runs = restyle(&[bold(0, 4)], 2, 6, StyleChange::Ink(2));
        assert_eq!(runs.len(), 3);
        assert_eq!(runs[1], Run { start: 2, end: 4, style: Style { flags: BOLD, ink: 2, hl: 0 } });
        assert_eq!(runs[2], Run { start: 4, end: 6, style: Style { flags: 0, ink: 2, hl: 0 } });
    }

    #[test]
    fn typing_after_run_continues_it() {
        assert_eq!(shift(&[bold(0, 3)], 3, 3, 2), vec![bold(0, 5)]);
        assert_eq!(shift(&[bold(2, 4)], 0, 0, 1), vec![bold(3, 5)]);
        assert_eq!(shift(&[bold(2, 4)], 3, 3, 1), vec![bold(2, 5)]);
    }

    #[test]
    fn deleting_and_replacing_selection() {
        assert_eq!(shift(&[bold(2, 6)], 3, 5, 0), vec![bold(2, 4)]);
        assert!(shift(&[bold(2, 6)], 2, 6, 0).is_empty());
        assert_eq!(shift(&[bold(2, 6)], 2, 6, 1), vec![bold(2, 3)]);
        assert_eq!(shift(&[bold(0, 2), bold(8, 9)], 4, 6, 0), vec![bold(0, 2), bold(6, 7)]);
    }

    #[test]
    fn split_and_join_roundtrip() {
        let runs = vec![bold(1, 5)];
        let (l, r) = split(&runs, 3);
        assert_eq!(l, vec![bold(1, 3)]);
        assert_eq!(r, vec![bold(0, 2)]);
        assert_eq!(join(&l, &r, 3), runs);
    }

    #[test]
    fn flatten_roundtrip() {
        let runs = vec![Run { start: 1, end: 2, style: Style { flags: ITALIC | STRIKE, ink: 3, hl: 1 } }];
        assert_eq!(unflatten(&flatten(&runs)), runs);
    }
}
