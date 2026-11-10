/* tslint:disable */
/* eslint-disable */

export class Caret {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    block_id: number;
    end: number;
    start: number;
}

export class Session {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Aligns every line touched by `start..end` (collapsed => the caret line). Undoable.
     */
    align_lines(id: number, start: number, end: number, align: number): boolean;
    /**
     * `kind`: bold | italic | underline | strike (value 0/1), ink | hl (palette index, 0 = none), clear.
     */
    apply_style(id: number, start: number, end: number, kind: string, value: number): boolean;
    can_redo(): boolean;
    can_undo(): boolean;
    delete_image(image_id: number): Caret | undefined;
    /**
     * Removes a table block (one undoable step); returns where the caret should go.
     */
    delete_table(table_id: number): Caret | undefined;
    edit(id: number, start: number, end: number, text: string, coalesce: boolean): void;
    effective_language(id: number): string;
    encoding(): string;
    encoding_label(): string;
    eol(): string;
    eol_label(): string;
    export_bytes(): Uint8Array;
    export_text(): string;
    find(query: string, case_sensitive: boolean, from_id: number, from_pos: number, backwards: boolean): Caret | undefined;
    find_count(query: string, case_sensitive: boolean): number;
    first_text_id(): number;
    /**
     * Sets the font of every line touched by `start..end` (collapsed => caret line).
     * Undoable; never touches the text.
     */
    font_lines(id: number, start: number, end: number, font: number): boolean;
    force_language(lang: string): void;
    format_all(): string;
    has_marks(): boolean;
    highlight(id: number): Uint32Array;
    image_of(id: number): Uint8Array;
    insert_image(id: number, at: number, mime: string, bytes: Uint8Array): number;
    /**
     * Caret that should focus the text after the new image. `block_id` 0 means the insert was refused.
     */
    insert_image_caret(id: number, at: number, mime: string, bytes: Uint8Array): Caret | undefined;
    /**
     * Inserts an empty table after `after` and returns its block id.
     */
    insert_table(after: number, cols: number, rows: number): number;
    /**
     * Splits text block `id` at UTF-16 offset `at` and inserts a table there.
     * Returns the caret for the text below the table.
     */
    insert_table_at(id: number, at: number, cols: number, rows: number): Caret | undefined;
    is_dirty(): boolean;
    language(): string;
    /**
     * Per-line align ids for a text block (one per line: 0 left, 1 centre, 2 right).
     */
    line_aligns(id: number): Uint8Array;
    /**
     * Per-line font codes for a text block (one per line; 0 = default font).
     */
    line_fonts(id: number): Uint8Array;
    /**
     * Per-line paragraph-style codes for a text block (one per line; 0 = body).
     */
    line_styles(id: number): Uint8Array;
    line_to_caret(line: number): Caret;
    mark_clean(): void;
    mark_dirty(): void;
    /**
     * Flat `[start, end, flags, ink, hl]*` style runs for a text block.
     */
    marks(id: number): Uint32Array;
    metrics(id: number, pos: number): Uint32Array;
    mime_of(id: number): string;
    constructor();
    open_bytes(bytes: Uint8Array): string;
    outline(): string;
    redo(): Caret | undefined;
    replace_all(query: string, replacement: string, case_sensitive: boolean): number;
    /**
     * Restores per-line aligns on load.
     */
    restore_aligns(id: number, aligns: Uint8Array): void;
    restore_begin(): void;
    restore_end(language: string, eol: string, encoding: string): void;
    /**
     * Restores per-line fonts on load.
     */
    restore_fonts(id: number, fonts: Uint8Array): void;
    restore_image(mime: string, bytes: Uint8Array): number;
    restore_marks(id: number, flat: Uint32Array): void;
    /**
     * Restores per-line paragraph styles on load.
     */
    restore_styles(id: number, styles: Uint8Array): void;
    /**
     * Loads a table from `{"cols":n,"cells":[{"t":"…","m":[…],"f":n}]}`.
     */
    restore_table(json: string): number;
    restore_text(text: string): number;
    set_encoding(enc: string): string;
    set_eol(eol: string): boolean;
    set_language(lang: string): void;
    /**
     * Sets the paragraph style of every line touched by `start..end` (collapsed => caret
     * line). Undoable; never touches the text.
     */
    style_lines(id: number, start: number, end: number, style: number): boolean;
    /**
     * Aligns every cell in the rectangle `r0..=r1` × `c0..=c1` (a single cell when the
     * corners match). 0 left, 1 centre, 2 right. One undoable step. Fixes BUG-2.
     */
    table_align(id: number, r0: number, c0: number, r1: number, c1: number, align: number): boolean;
    table_delete_col(id: number, at: number): boolean;
    table_delete_row(id: number, at: number): boolean;
    table_fill(id: number, target: string, row: number, col: number, fill: number): boolean;
    table_insert_col(id: number, at: number): boolean;
    table_insert_row(id: number, at: number): boolean;
    table_json(id: number): string;
    table_marks(id: number, row: number, col: number): Uint32Array;
    table_set_marks(id: number, row: number, col: number, flat: Uint32Array): boolean;
    table_set_text(id: number, row: number, col: number, text: string): boolean;
    table_style(id: number, row: number, col: number, start: number, end: number, kind: string, value: number): boolean;
    text_of(id: number): string;
    undo(): Caret | undefined;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_caret_free: (a: number, b: number) => void;
    readonly __wbg_get_caret_block_id: (a: number) => number;
    readonly __wbg_get_caret_end: (a: number) => number;
    readonly __wbg_get_caret_start: (a: number) => number;
    readonly __wbg_session_free: (a: number, b: number) => void;
    readonly __wbg_set_caret_block_id: (a: number, b: number) => void;
    readonly __wbg_set_caret_end: (a: number, b: number) => void;
    readonly __wbg_set_caret_start: (a: number, b: number) => void;
    readonly session_align_lines: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly session_apply_style: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly session_can_redo: (a: number) => number;
    readonly session_can_undo: (a: number) => number;
    readonly session_delete_image: (a: number, b: number) => number;
    readonly session_delete_table: (a: number, b: number) => number;
    readonly session_edit: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly session_effective_language: (a: number, b: number) => [number, number];
    readonly session_encoding: (a: number) => [number, number];
    readonly session_encoding_label: (a: number) => [number, number];
    readonly session_eol: (a: number) => [number, number];
    readonly session_eol_label: (a: number) => [number, number];
    readonly session_export_bytes: (a: number) => [number, number, number, number];
    readonly session_export_text: (a: number) => [number, number];
    readonly session_find: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly session_find_count: (a: number, b: number, c: number, d: number) => number;
    readonly session_first_text_id: (a: number) => number;
    readonly session_font_lines: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly session_force_language: (a: number, b: number, c: number) => void;
    readonly session_format_all: (a: number) => [number, number];
    readonly session_has_marks: (a: number) => number;
    readonly session_highlight: (a: number, b: number) => [number, number];
    readonly session_image_of: (a: number, b: number) => [number, number];
    readonly session_insert_image: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly session_insert_image_caret: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly session_insert_table: (a: number, b: number, c: number, d: number) => number;
    readonly session_insert_table_at: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly session_is_dirty: (a: number) => number;
    readonly session_language: (a: number) => [number, number];
    readonly session_line_aligns: (a: number, b: number) => [number, number];
    readonly session_line_fonts: (a: number, b: number) => [number, number];
    readonly session_line_styles: (a: number, b: number) => [number, number];
    readonly session_line_to_caret: (a: number, b: number) => number;
    readonly session_mark_clean: (a: number) => void;
    readonly session_mark_dirty: (a: number) => void;
    readonly session_marks: (a: number, b: number) => [number, number];
    readonly session_metrics: (a: number, b: number, c: number) => [number, number];
    readonly session_mime_of: (a: number, b: number) => [number, number];
    readonly session_new: () => number;
    readonly session_open_bytes: (a: number, b: number, c: number) => [number, number];
    readonly session_outline: (a: number) => [number, number];
    readonly session_redo: (a: number) => number;
    readonly session_replace_all: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly session_restore_aligns: (a: number, b: number, c: number, d: number) => void;
    readonly session_restore_begin: (a: number) => void;
    readonly session_restore_end: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly session_restore_fonts: (a: number, b: number, c: number, d: number) => void;
    readonly session_restore_image: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly session_restore_marks: (a: number, b: number, c: number, d: number) => void;
    readonly session_restore_styles: (a: number, b: number, c: number, d: number) => void;
    readonly session_restore_table: (a: number, b: number, c: number) => number;
    readonly session_restore_text: (a: number, b: number, c: number) => number;
    readonly session_set_encoding: (a: number, b: number, c: number) => [number, number];
    readonly session_set_eol: (a: number, b: number, c: number) => number;
    readonly session_set_language: (a: number, b: number, c: number) => void;
    readonly session_style_lines: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly session_table_align: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly session_table_delete_col: (a: number, b: number, c: number) => number;
    readonly session_table_delete_row: (a: number, b: number, c: number) => number;
    readonly session_table_fill: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly session_table_insert_col: (a: number, b: number, c: number) => number;
    readonly session_table_insert_row: (a: number, b: number, c: number) => number;
    readonly session_table_json: (a: number, b: number) => [number, number];
    readonly session_table_marks: (a: number, b: number, c: number, d: number) => [number, number];
    readonly session_table_set_marks: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly session_table_set_text: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly session_table_style: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly session_text_of: (a: number, b: number) => [number, number];
    readonly session_undo: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
