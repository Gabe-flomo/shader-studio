use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

mod osc_listener;

// ── FFmpeg session state ──────────────────────────────────────────────────────

struct FfmpegSession {
    child: Child,
    stdin: ChildStdin,
    width: u32,
    height: u32,
    /// The recording's sound, written for FFmpeg to read; removed when the encode ends.
    audio_file: Option<std::path::PathBuf>,
}

struct FfmpegState(Mutex<Option<FfmpegSession>>);

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Start an FFmpeg encoding session.
/// `codec` is one of: "h264", "prores", "prores4444" (keeps alpha), "ffv1"
/// `audio_wav`, when given, is the recording's sound as a WAV file's bytes: it's
/// muxed in as the audio track (AAC in .mp4, PCM in .mov, FLAC in .mkv).
/// Returns an error string if FFmpeg can't be found or the session is already active.
#[tauri::command]
fn start_ffmpeg_encode(
    state: State<FfmpegState>,
    output_path: String,
    width: u32,
    height: u32,
    fps: u32,
    codec: String,
    audio_wav: Option<Vec<u8>>,
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
        "prores4444" => vec![
            "-c:v", "prores_ks",
            "-profile:v", "4",         // ProRes 4444: carries the alpha channel
            "-vendor", "apl0",
            "-pix_fmt", "yuva444p10le",
            "-alpha_bits", "16",
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
    // The sound, as a second input: a temporary WAV beside nothing the user sees.
    let audio_file = match audio_wav {
        Some(bytes) if !bytes.is_empty() => {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!("shader-studio-audio-{}-{}.wav", std::process::id(), stamp));
            std::fs::write(&path, &bytes).map_err(|e| format!("Couldn't write the recording's audio: {e}"))?;
            Some(path)
        }
        _ => None,
    };
    if let Some(path) = &audio_file {
        cmd.arg("-i").arg(path);
    }
    cmd.args(&codec_args);
    if audio_file.is_some() {
        let audio_codec: &[&str] = match codec.as_str() {
            "prores" | "prores4444" => &["-c:a", "pcm_s16le"],
            "ffv1" => &["-c:a", "flac"],
            _ => &["-c:a", "aac", "-b:a", "320k"],
        };
        cmd.args(audio_codec);
        cmd.arg("-shortest");
    }
    cmd.args(["-movflags", "+faststart"]);
    cmd.arg(&output_path);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            if let Some(path) = &audio_file { let _ = std::fs::remove_file(path); }
            return Err(format!("Failed to spawn FFmpeg: {e}"));
        }
    };
    let stdin     = child.stdin.take().ok_or("Failed to get FFmpeg stdin")?;

    *guard = Some(FfmpegSession { child, stdin, width, height, audio_file });
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
        .map_err(|e| format!("FFmpeg wait error: {e}"));
    if let Some(path) = &session.audio_file { let _ = std::fs::remove_file(path); }
    let status = status?;

    if !status.status.success() {
        return Err(format!("FFmpeg exited with code {:?}", status.status.code()));
    }
    Ok(())
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// ── OSC in (Play page) ────────────────────────────────────────────────────────
//
// The desktop app listens for OSC itself, so Ableton / TouchOSC reach the Play
// page with one click. Each datagram goes to the webview as an `osc-packet`
// event (an array of bytes); src/lib/oscClient.ts decodes it.

struct OscState(Mutex<Option<osc_listener::Listener>>);

/// Start (or keep) listening on UDP `port`. `lan` accepts other devices on
/// the network. Returns the bound port.
#[tauri::command]
fn osc_start(app: AppHandle, state: State<OscState>, port: u16, lan: bool) -> Result<u16, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(l) = guard.as_ref() {
        if l.port() == port && l.lan() == lan {
            return Ok(port);
        }
    }
    if let Some(old) = guard.take() {
        old.stop();
    }
    let listener = osc_listener::Listener::start(port, lan, move |packet: Vec<u8>| {
        let _ = app.emit("osc-packet", packet);
    })?;
    let bound = listener.port();
    *guard = Some(listener);
    Ok(bound)
}

#[tauri::command]
fn osc_stop(state: State<OscState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(l) = guard.take() {
        l.stop();
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(FfmpegState(Mutex::new(None)))
        .manage(OscState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_ffmpeg_encode,
            send_frame_rgba,
            stop_ffmpeg_encode,
            osc_start,
            osc_stop,
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
