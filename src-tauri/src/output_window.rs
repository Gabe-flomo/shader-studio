// ── The output window (docs/projection.md) ───────────────────────────────────
//
// A second window showing only the picture, for a projector or another display:
// output.html, labelled "output". The main window lists the displays, opens the
// output on one (full screen or not) and hands it the Play; the two windows then
// talk through events ('pf-output-down' / 'pf-output-up', src/output/transport.ts).
// The Play record can be several megabytes (images and videos inside), too much for
// an event, so it waits here for the output to fetch.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const OUTPUT_LABEL: &str = "output";

#[derive(Default)]
pub struct OutputState(pub Mutex<String>);

#[derive(serde::Serialize)]
pub struct MonitorInfo {
    index: usize,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
    primary: bool,
}

/// Every display: its name, where it sits and its size in pixels.
#[tauri::command]
pub fn output_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let primary_pos = primary.as_ref().map(|m| *m.position());
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, m)| {
            let pos = *m.position();
            let size = *m.size();
            MonitorInfo {
                index,
                name: m.name().cloned().unwrap_or_else(|| format!("Display {}", index + 1)),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                scale: m.scale_factor(),
                primary: primary_pos.map(|p| p == pos).unwrap_or(index == 0),
            }
        })
        .collect())
}

/// Open the output window on display `monitor` (an index from output_monitors; none = where it is),
/// or move the open one there, full screen or not. Async: making a window from a
/// synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn output_open(app: AppHandle, monitor: Option<usize>, fullscreen: bool) -> Result<(), String> {
    let target = match monitor {
        Some(i) => app.available_monitors().map_err(|e| e.to_string())?.into_iter().nth(i),
        None => None,
    };
    let win = match app.get_webview_window(OUTPUT_LABEL) {
        Some(w) => w,
        None => {
            let w = WebviewWindowBuilder::new(&app, OUTPUT_LABEL, WebviewUrl::App("output.html".into()))
                .title("Playfield output")
                .inner_size(1280.0, 720.0)
                .min_inner_size(320.0, 180.0)
                .background_color(tauri::window::Color(0, 0, 0, 255))
                .build()
                .map_err(|e| e.to_string())?;
            // Closed by hand (⌘W, the close button): tell the main window.
            let handle = app.clone();
            w.on_window_event(move |event| {
                if let WindowEvent::Destroyed = event {
                    let _ = handle.emit_to("main", "pf-output-up", serde_json::json!({ "type": "closed" }));
                }
            });
            w
        }
    };
    if let Some(m) = target {
        // Leave full screen first: a full-screen window can't move to another display.
        if win.is_fullscreen().unwrap_or(false) {
            let _ = win.set_fullscreen(false);
        }
        let pos = *m.position();
        let size = *m.size();
        win.set_position(PhysicalPosition::new(pos.x, pos.y)).map_err(|e| e.to_string())?;
        win.set_size(PhysicalSize::new(size.width, size.height)).map_err(|e| e.to_string())?;
    }
    win.set_fullscreen(fullscreen).map_err(|e| e.to_string())?;
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn output_close(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(OUTPUT_LABEL) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn output_fullscreen(app: AppHandle, on: bool) -> Result<(), String> {
    match app.get_webview_window(OUTPUT_LABEL) {
        Some(w) => w.set_fullscreen(on).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// The main window leaves the Play (as JSON) for the output to fetch.
#[tauri::command]
pub fn output_record_put(state: State<OutputState>, json: String) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = json;
    Ok(())
}

#[tauri::command]
pub fn output_record_get(state: State<OutputState>) -> Result<String, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}
