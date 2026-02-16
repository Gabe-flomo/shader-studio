use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

// ── FFmpeg session state ──────────────────────────────────────────────────────

struct FfmpegSession {
    child: Child,
    stdin: ChildStdin,
    width: u32,
    height: u32,
}

struct FfmpegState(Mutex<Option<FfmpegSession>>);

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Start an FFmpeg encoding session.
/// `codec` is one of: "h264", "prores", "ffv1"
/// Returns an error string if FFmpeg can't be found or the session is already active.
#[tauri::command]
fn start_ffmpeg_encode(
    state: State<FfmpegState>,
    output_path: String,
    width: u32,
    height: u32,
    fps: u32,
    codec: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("FFmpeg session already active".into());
    }

    // Resolve FFmpeg binary — ffmpeg-sidecar will download a static build on first use
    ffmpeg_sidecar::download::auto_download().map_err(|e| e.to_string())?;
    let ffmpeg_path = ffmpeg_sidecar::paths::ffmpeg_path();

    // Build codec-specific output args
    let codec_args: Vec<&str> = match codec.as_str() {
        "prores" => vec![
            "-c:v", "prores_ks",
            "-profile:v", "3",         // ProRes 422 HQ
            "-vendor", "apl0",
            "-pix_fmt", "yuv422p10le",
        ],
        "ffv1" => vec![
            "-c:v", "ffv1",
            "-level", "3",
            "-coder", "1",
            "-context", "1",
            "-pix_fmt", "yuv420p",
        ],
        _ => vec![              // h264 (default)
            "-c:v", "libx264",
            "-preset", "slow",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
        ],
    };

    let fps_str  = fps.to_string();
    let size_str = format!("{}x{}", width, height);

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args([
        "-y",                      // overwrite
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-pix_fmt", "rgba",
        "-s", &size_str,
        "-r", &fps_str,
        "-i", "pipe:0",            // read frames from stdin
    ]);
    cmd.args(&codec_args);
    cmd.args(["-movflags", "+faststart"]);
    cmd.arg(&output_path);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn FFmpeg: {e}"))?;
    let stdin     = child.stdin.take().ok_or("Failed to get FFmpeg stdin")?;

    *guard = Some(FfmpegSession { child, stdin, width, height });
    Ok(())
}

/// Send a single raw RGBA frame (width × height × 4 bytes) to FFmpeg stdin.
#[tauri::command]
fn send_frame_rgba(
    state: State<FfmpegState>,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let session   = guard.as_mut().ok_or("No active FFmpeg session")?;

    let expected = (session.width * session.height * 4) as usize;
    if data.len() != expected {
        return Err(format!(
            "Frame size mismatch: got {} bytes, expected {}",
            data.len(), expected
        ));
    }

    session.stdin.write_all(&data).map_err(|e| format!("FFmpeg stdin write error: {e}"))?;
    Ok(())
}

/// Close FFmpeg stdin and wait for the process to finish encoding.
#[tauri::command]
fn stop_ffmpeg_encode(state: State<FfmpegState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let session   = guard.take().ok_or("No active FFmpeg session")?;

    // Dropping stdin closes the pipe — FFmpeg will flush and exit cleanly
    drop(session.stdin);
    let status = session.child
        .wait_with_output()
        .map_err(|e| format!("FFmpeg wait error: {e}"))?;

    if !status.status.success() {
        return Err(format!("FFmpeg exited with code {:?}", status.status.code()));
    }
    Ok(())
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(FfmpegState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_ffmpeg_encode,
            send_frame_rgba,
            stop_ffmpeg_encode,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
