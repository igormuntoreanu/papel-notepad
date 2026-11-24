//! Frameless window chrome helpers for the custom title bar.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow};

/// Work-area rectangle for one snap zone.
///
/// `x`/`y`/`w`/`h` are fractions of the monitor work area (0–1). Each edge is
/// rounded once, so a left half and a right half share a pixel boundary.
pub fn zone_pixels(
    origin_x: i32,
    origin_y: i32,
    width: u32,
    height: u32,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> (i32, i32, u32, u32) {
    let clamp = |v: f64| v.clamp(0.0, 1.0);
    let x = clamp(x);
    let y = clamp(y);
    let w = clamp(w).min(1.0 - x);
    let h = clamp(h).min(1.0 - y);
    let width = width as f64;
    let height = height as f64;
    let left = origin_x + (width * x).round() as i32;
    let top = origin_y + (height * y).round() as i32;
    let right = origin_x + (width * (x + w)).round() as i32;
    let bottom = origin_y + (height * (y + h)).round() as i32;
    (
        left,
        top,
        (right - left).max(1) as u32,
        (bottom - top).max(1) as u32,
    )
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window missing".into())
}

#[tauri::command]
pub fn desktop_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn desktop_minimize(app: AppHandle) -> Result<(), String> {
    main_window(&app)?.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_toggle_maximize(app: AppHandle) -> Result<(), String> {
    let win = main_window(&app)?;
    if win.is_maximized().map_err(|e| e.to_string())? {
        win.unmaximize().map_err(|e| e.to_string())
    } else {
        win.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn desktop_is_maximized(app: AppHandle) -> Result<bool, String> {
    main_window(&app)?.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_close(app: AppHandle) -> Result<(), String> {
    main_window(&app)?.close().map_err(|e| e.to_string())
}

/// Place the window in one snap zone of the current monitor's work area.
///
/// Fractions match `src/lib/desktop/snap-layouts.ts`. Un-maximizes first so a
/// maximized window can leave the full screen for a half or a quarter.
#[tauri::command]
pub fn desktop_snap(app: AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let win = main_window(&app)?;
    let was_maximized = win.is_maximized().map_err(|e| e.to_string())?;
    if was_maximized {
        win.unmaximize().map_err(|e| e.to_string())?;
        // Windows applies restore on a later tick. A size set in the same
        // call is dropped and the window stays at its restored rectangle.
        std::thread::sleep(std::time::Duration::from_millis(80));
    }
    let monitor = win
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no monitor".to_string())?;
    let area = monitor.work_area();
    let (left, top, width, height) = zone_pixels(
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
        x,
        y,
        w,
        h,
    );
    win.set_size(Size::Physical(PhysicalSize::new(width, height)))
        .map_err(|e| e.to_string())?;
    win.set_position(Position::Physical(PhysicalPosition::new(left, top)))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::zone_pixels;

    #[test]
    fn halves_share_an_edge_and_cover_the_work_area() {
        let (lx, ly, lw, lh) = zone_pixels(10, 20, 1920, 1040, 0.0, 0.0, 0.5, 1.0);
        let (rx, ry, rw, rh) = zone_pixels(10, 20, 1920, 1040, 0.5, 0.0, 0.5, 1.0);
        assert_eq!((lx, ly, lh), (10, 20, 1040));
        assert_eq!(ly, ry);
        assert_eq!(lh, rh);
        assert_eq!(lx + lw as i32, rx, "halves must meet");
        assert_eq!(lw + rw, 1920, "halves must cover the width");
    }

    #[test]
    fn a_quarter_is_half_the_work_area_each_way() {
        let (_, _, w, h) = zone_pixels(0, 0, 1600, 900, 0.5, 0.5, 0.5, 0.5);
        assert_eq!((w, h), (800, 450));
    }
}
