/* @ts-self-types="./quire_wasm.d.ts" */

export class Caret {
    static __wrap(ptr) {
        const obj = Object.create(Caret.prototype);
        obj.__wbg_ptr = ptr;
        CaretFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CaretFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_caret_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get block_id() {
        const ret = wasm.__wbg_get_caret_block_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get end() {
        const ret = wasm.__wbg_get_caret_end(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get start() {
        const ret = wasm.__wbg_get_caret_start(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} arg0
     */
    set block_id(arg0) {
        wasm.__wbg_set_caret_block_id(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set end(arg0) {
        wasm.__wbg_set_caret_end(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set start(arg0) {
        wasm.__wbg_set_caret_start(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) Caret.prototype[Symbol.dispose] = Caret.prototype.free;

export class Session {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_session_free(ptr, 0);
    }
    /**
     * `kind`: bold | italic | underline | strike (value 0/1), ink | hl (palette index, 0 = none), clear.
     * @param {number} id
     * @param {number} start
     * @param {number} end
     * @param {string} kind
     * @param {number} value
     * @returns {boolean}
     */
    apply_style(id, start, end, kind, value) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_apply_style(this.__wbg_ptr, id, start, end, ptr0, len0, value);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    can_redo() {
        const ret = wasm.session_can_redo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    can_undo() {
        const ret = wasm.session_can_undo(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} image_id
     * @returns {Caret | undefined}
     */
    delete_image(image_id) {
        const ret = wasm.session_delete_image(this.__wbg_ptr, image_id);
        return ret === 0 ? undefined : Caret.__wrap(ret);
    }
    /**
     * @param {number} id
     * @param {number} start
     * @param {number} end
     * @param {string} text
     * @param {boolean} coalesce
     */
    edit(id, start, end, text, coalesce) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.session_edit(this.__wbg_ptr, id, start, end, ptr0, len0, coalesce);
    }
    /**
     * @param {number} id
     * @returns {string}
     */
    effective_language(id) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_effective_language(this.__wbg_ptr, id);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    encoding() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_encoding(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    encoding_label() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_encoding_label(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    eol() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_eol(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    eol_label() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_eol_label(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Uint8Array}
     */
    export_bytes() {
        const ret = wasm.session_export_bytes(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {string}
     */
    export_text() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_export_text(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} query
     * @param {boolean} case_sensitive
     * @param {number} from_id
     * @param {number} from_pos
     * @param {boolean} backwards
     * @returns {Caret | undefined}
     */
    find(query, case_sensitive, from_id, from_pos, backwards) {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_find(this.__wbg_ptr, ptr0, len0, case_sensitive, from_id, from_pos, backwards);
        return ret === 0 ? undefined : Caret.__wrap(ret);
    }
    /**
     * @param {string} query
     * @param {boolean} case_sensitive
     * @returns {number}
     */
    find_count(query, case_sensitive) {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_find_count(this.__wbg_ptr, ptr0, len0, case_sensitive);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    first_text_id() {
        const ret = wasm.session_first_text_id(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {string} lang
     */
    force_language(lang) {
        const ptr0 = passStringToWasm0(lang, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.session_force_language(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {string}
     */
    format_all() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_format_all(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    has_marks() {
        const ret = wasm.session_has_marks(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} id
     * @returns {Uint32Array}
     */
    highlight(id) {
        const ret = wasm.session_highlight(this.__wbg_ptr, id);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} id
     * @returns {Uint8Array}
     */
    image_of(id) {
        const ret = wasm.session_image_of(this.__wbg_ptr, id);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {number} id
     * @param {number} at
     * @param {string} mime
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    insert_image(id, at, mime, bytes) {
        const ptr0 = passStringToWasm0(mime, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.session_insert_image(this.__wbg_ptr, id, at, ptr0, len0, ptr1, len1);
        return ret >>> 0;
    }
    /**
     * Caret that should focus the text after the new image. `block_id` 0 means the insert was refused.
     * @param {number} id
     * @param {number} at
     * @param {string} mime
     * @param {Uint8Array} bytes
     * @returns {Caret | undefined}
     */
    insert_image_caret(id, at, mime, bytes) {
        const ptr0 = passStringToWasm0(mime, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.session_insert_image_caret(this.__wbg_ptr, id, at, ptr0, len0, ptr1, len1);
        return ret === 0 ? undefined : Caret.__wrap(ret);
    }
    /**
     * @returns {boolean}
     */
    is_dirty() {
        const ret = wasm.session_is_dirty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {string}
     */
    language() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_language(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {number} line
     * @returns {Caret}
     */
    line_to_caret(line) {
        const ret = wasm.session_line_to_caret(this.__wbg_ptr, line);
        return Caret.__wrap(ret);
    }
    mark_clean() {
        wasm.session_mark_clean(this.__wbg_ptr);
    }
    /**
     * Flat `[start, end, flags, ink, hl]*` style runs for a text block.
     * @param {number} id
     * @returns {Uint32Array}
     */
    marks(id) {
        const ret = wasm.session_marks(this.__wbg_ptr, id);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} id
     * @param {number} pos
     * @returns {Uint32Array}
     */
    metrics(id, pos) {
        const ret = wasm.session_metrics(this.__wbg_ptr, id, pos);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} id
     * @returns {string}
     */
    mime_of(id) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_mime_of(this.__wbg_ptr, id);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    constructor() {
        const ret = wasm.session_new();
        this.__wbg_ptr = ret;
        SessionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    open_bytes(bytes) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_open_bytes(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    outline() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_outline(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Caret | undefined}
     */
    redo() {
        const ret = wasm.session_redo(this.__wbg_ptr);
        return ret === 0 ? undefined : Caret.__wrap(ret);
    }
    /**
     * @param {string} query
     * @param {string} replacement
     * @param {boolean} case_sensitive
     * @returns {number}
     */
    replace_all(query, replacement, case_sensitive) {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(replacement, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.session_replace_all(this.__wbg_ptr, ptr0, len0, ptr1, len1, case_sensitive);
        return ret >>> 0;
    }
    restore_begin() {
        wasm.session_restore_begin(this.__wbg_ptr);
    }
    /**
     * @param {string} language
     * @param {string} eol
     * @param {string} encoding
     */
    restore_end(language, eol, encoding) {
        const ptr0 = passStringToWasm0(language, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(eol, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(encoding, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        wasm.session_restore_end(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
    }
    /**
     * @param {string} mime
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    restore_image(mime, bytes) {
        const ptr0 = passStringToWasm0(mime, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.session_restore_image(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret >>> 0;
    }
    /**
     * @param {number} id
     * @param {Uint32Array} flat
     */
    restore_marks(id, flat) {
        const ptr0 = passArray32ToWasm0(flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.session_restore_marks(this.__wbg_ptr, id, ptr0, len0);
    }
    /**
     * @param {string} text
     * @returns {number}
     */
    restore_text(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_restore_text(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * @param {string} enc
     * @returns {string}
     */
    set_encoding(enc) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(enc, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.session_set_encoding(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {string} eol
     * @returns {boolean}
     */
    set_eol(eol) {
        const ptr0 = passStringToWasm0(eol, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.session_set_eol(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {string} lang
     */
    set_language(lang) {
        const ptr0 = passStringToWasm0(lang, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.session_set_language(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} id
     * @returns {string}
     */
    text_of(id) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.session_text_of(this.__wbg_ptr, id);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Caret | undefined}
     */
    undo() {
        const ret = wasm.session_undo(this.__wbg_ptr);
        return ret === 0 ? undefined : Caret.__wrap(ret);
    }
}
if (Symbol.dispose) Session.prototype[Symbol.dispose] = Session.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./quire_wasm_bg.js": import0,
    };
}

const CaretFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_caret_free(ptr, 1));
const SessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_session_free(ptr, 1));

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('quire_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
