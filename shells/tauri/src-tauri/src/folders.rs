//! Folder I/O for the desktop shell.
//!
//! The web app drives folder autosave through the File System Access API, which
//! WebView2 does not implement. These commands give it the same capability:
//! the user picks a folder once, then notes are read and written by name.
//!
//! Security boundary: the id handed to the web view is the folder path, so
//! every command first checks the path against folders the user actually picked
//! (`folders.json`, beside the exe). Without that, any script running in the
//! web view could write anywhere the user can.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use serde::{Deserialize, Serialize};

/// A directory the web app may address: stable id plus display name.
#[derive(Clone, Serialize, Deserialize)]
pub struct DesktopDir {
    /// The canonical folder path. Also the key `folders.json` stores.
    pub id: String,
    /// Last path segment, shown in the app header.
    pub name: String,
}

/// Folders the user granted, persisted so a restart keeps autosave working.
pub struct Folders {
    dirs: Mutex<Vec<PathBuf>>,
    store: PathBuf,
}

impl Folders {
    /// Load the allowlist, tolerating a missing or corrupt file: the worst case
    /// is that the user picks the folder again.
    pub fn load(store: PathBuf) -> Self {
        let dirs = std::fs::read_to_string(&store)
            .ok()
            .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
            .unwrap_or_default()
            .into_iter()
            .map(PathBuf::from)
            .collect();
        Self {
            dirs: Mutex::new(dirs),
            store,
        }
    }

    fn allow(&self, path: &Path) -> Result<(), String> {
        let mut dirs = self.dirs.lock().map_err(|_| "folder state unavailable")?;
        if dirs.iter().any(|dir| dir == path) {
            return Ok(());
        }
        dirs.push(path.to_path_buf());
        let serialized: Vec<String> = dirs
            .iter()
            .map(|dir| dir.to_string_lossy().into_owned())
            .collect();
        if let Some(parent) = self.store.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let json = serde_json::to_string_pretty(&serialized).map_err(|err| err.to_string())?;
        std::fs::write(&self.store, json).map_err(|err| err.to_string())?;
        Ok(())
    }

    /// The canonical path for `dir_id`, or an error when the user never granted it.
    fn resolve(&self, dir_id: &str) -> Result<PathBuf, String> {
        let path = std::fs::canonicalize(dir_id).map_err(|_| "folder not found".to_string())?;
        if !path.is_dir() {
            return Err("not a folder".to_string());
        }
        let dirs = self.dirs.lock().map_err(|_| "folder state unavailable")?;
        if dirs.iter().any(|dir| dir == &path) {
            Ok(path)
        } else {
            Err("folder was not chosen by the user".to_string())
        }
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn dir_for(path: &Path) -> DesktopDir {
    DesktopDir {
        id: path.to_string_lossy().into_owned(),
        name: display_name(path),
    }
}

/// Reject separators and `..` so a name can only address a file in the folder.
fn child(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let invalid = name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':');
    if invalid {
        return Err("invalid file name".to_string());
    }
    Ok(dir.join(name))
}

fn write_bytes(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    std::fs::write(path, data).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn desktop_pick_directory(folders: tauri::State<'_, Folders>) -> Option<DesktopDir> {
    // `PAPEL_FOLDER` skips the native dialog. A dialog cannot be driven by an
    // automated capture, and the bridge can only be proven end-to-end (pick, list,
    // read, write) if the picker can be answered without a human.
    if let Some(preset) = std::env::var_os("PAPEL_FOLDER").map(std::path::PathBuf::from) {
        if preset.is_dir() {
            let canonical = std::fs::canonicalize(&preset).unwrap_or(preset);
            folders.allow(&canonical).ok()?;
            return Some(dir_for(&canonical));
        }
    }
    let picked = rfd::FileDialog::new().set_title("Choose a folder for Papel").pick_folder()?;
    let canonical = std::fs::canonicalize(&picked).unwrap_or(picked);
    folders.allow(&canonical).ok()?;
    Some(dir_for(&canonical))
}

#[tauri::command]
pub fn desktop_resolve_directory(
    folders: tauri::State<'_, Folders>,
    id: String,
) -> Option<DesktopDir> {
    let path = folders.resolve(&id).ok()?;
    Some(dir_for(&path))
}

#[tauri::command]
pub fn desktop_read_file(
    folders: tauri::State<'_, Folders>,
    dir_id: String,
    name: String,
) -> Result<Option<String>, String> {
    let dir = folders.resolve(&dir_id)?;
    let path = child(&dir, &name)?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(base64::engine::general_purpose::STANDARD.encode(bytes))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn desktop_write_file(
    folders: tauri::State<'_, Folders>,
    dir_id: String,
    name: String,
    data: String,
) -> Result<(), String> {
    let dir = folders.resolve(&dir_id)?;
    let path = child(&dir, &name)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|err| err.to_string())?;
    write_bytes(&path, &bytes)
}

#[tauri::command]
pub fn desktop_remove_file(
    folders: tauri::State<'_, Folders>,
    dir_id: String,
    name: String,
) -> Result<(), String> {
    let dir = folders.resolve(&dir_id)?;
    let path = child(&dir, &name)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn desktop_list_files(
    folders: tauri::State<'_, Folders>,
    dir_id: String,
) -> Result<Vec<String>, String> {
    let dir = folders.resolve(&dir_id)?;
    let entries = std::fs::read_dir(&dir).map_err(|err| err.to_string())?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        // Files only: the adapter reports `kind === "file"` for everything it
        // yields, and folders are not notes.
        if entry.file_type().map(|kind| kind.is_file()).unwrap_or(false) {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn desktop_save_file(name: String, data: String, mime: String) -> Result<bool, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("Save sheet")
        .set_file_name(&name)
        .save_file()
    else {
        return Ok(false);
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|err| err.to_string())?;
    write_bytes(&path, &bytes)?;
    let _ = mime;
    Ok(true)
}
