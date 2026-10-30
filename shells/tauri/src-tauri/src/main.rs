// Windows release builds are GUI apps: no console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod folders;
mod window;

use std::path::PathBuf;

use folders::Folders;

/// Where the app keeps its state.
///
/// Portable by default: `data/` next to the executable, so moving or copying
/// the folder carries the notes, the IndexedDB autosave and the WebView profile
/// with it. `PAPEL_DATA_DIR` overrides it (for example `%APPDATA%\Papel` for an
/// install that must not write beside the binary).
fn data_root() -> PathBuf {
    if let Some(dir) = std::env::var_os("PAPEL_DATA_DIR") {
        let dir = PathBuf::from(dir);
        if !dir.as_os_str().is_empty() {
            return dir;
        }
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from))
        .map(|dir| dir.join("data"))
        .unwrap_or_else(|| PathBuf::from("data"))
}

fn main() {
    let root = data_root();
    let webview_data = root.join("webview2");
    std::fs::create_dir_all(&webview_data).ok();
    // The folder allowlist lives beside the app so autosave survives a restart
    // without the user re-picking the folder.
    let folders = Folders::load(root.join("folders.json"));

    tauri::Builder::default()
        .manage(folders)
        .invoke_handler(tauri::generate_handler![
            folders::desktop_pick_directory,
            folders::desktop_resolve_directory,
            folders::desktop_read_file,
            folders::desktop_write_file,
            folders::desktop_remove_file,
            folders::desktop_list_files,
            folders::desktop_save_file,
            window::desktop_app_version,
            window::desktop_minimize,
            window::desktop_toggle_maximize,
            window::desktop_is_maximized,
            window::desktop_close,
        ])
        .setup(move |app| {
            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Papel")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .resizable(true)
            .decorations(false)
            .visible(true)
            // Defines `window.__PAPEL_DESKTOP__` before the bundle runs.
            .initialization_script(include_str!("bridge.js"));

            // Keep the whole profile inside the portable folder. Without this,
            // WebView2 writes IndexedDB to %LOCALAPPDATA%, and notes would not
            // travel with the exe.
            #[cfg(windows)]
            {
                builder = builder.data_directory(webview_data.clone());
            }

            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Papel");
}
