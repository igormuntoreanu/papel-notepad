/**
 * Injected before the app's own scripts, so `window.__PAPEL_DESKTOP__` exists by
 * the time the first module runs. It is the Tauri flavour of the bridge
 * contract in `src/lib/desktop/bridge.ts`: same names, same `Uint8Array`
 * values, base64 only as the IPC transport.
 */
(() => {
  // Resolve IPC lazily. An initialization script runs *before* Tauri publishes
  // `window.__TAURI__`, so reading it here would leave the bridge undefined for the
  // whole session - the folder gate would never appear. `__TAURI_INTERNALS__.invoke`
  // is present this early; the public API is preferred when it exists.
  function invoke(command, args) {
    const api = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    const internals = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    const call = api || internals;
    if (!call) {
      return Promise.reject(new Error("Tauri IPC is not available"));
    }
    return call(command, args);
  }

  function toBase64(bytes) {
    let out = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function fromBase64(text) {
    const raw = atob(text);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  window.__PAPEL_DESKTOP__ = {
    version: 1,
    pickDirectory: () => invoke("desktop_pick_directory"),
    resolveDirectory: (id) => invoke("desktop_resolve_directory", { id }),
    readFile: async (dirId, name) => {
      const encoded = await invoke("desktop_read_file", { dirId, name });
      return encoded === null || encoded === undefined ? null : fromBase64(encoded);
    },
    writeFile: (dirId, name, bytes) =>
      invoke("desktop_write_file", { dirId, name, data: toBase64(bytes) }),
    removeFile: (dirId, name) => invoke("desktop_remove_file", { dirId, name }),
    listFiles: (dirId) => invoke("desktop_list_files", { dirId }),
    saveFile: (name, bytes, mime) =>
      invoke("desktop_save_file", { name, data: toBase64(bytes), mime }),
  };
})();
