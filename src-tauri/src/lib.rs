use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

mod audio_engine;
mod data_fetch;
mod midi;
mod playfile;
mod workspace;
mod linked;
mod osc_listener;
mod output_window;

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

/// FFmpeg's arguments to put `wav` under a finished recording `video` (its
/// picture copied, never re-encoded), written to `out`: the WAV shifted by
/// `offset` seconds (positive: it starts later than the picture), mixed with
/// the video's own sound when it has one (`mix`), else as the sound track.
pub fn mux_args(video: &str, wav: &str, offset: f64, mix: bool, out: &str) -> Vec<String> {
    let mut a: Vec<String> = vec!["-y".into(), "-i".into(), video.into(), "-itsoffset".into(), format!("{offset:.4}"), "-i".into(), wav.into()];
    if mix {
        // Both at full level; the mix stays under 0 dBFS as each source did (no normalisation).
        a.extend(["-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[a]", "-map", "0:v:0", "-map", "[a]"].map(String::from));
    } else {
        a.extend(["-map", "0:v:0", "-map", "1:a:0", "-shortest"].map(String::from));
    }
    let aac = std::path::Path::new(out).extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("mp4") || e.eq_ignore_ascii_case("m4v"));
    a.extend(["-c:v", "copy", "-c:a", if aac { "aac" } else { "pcm_s16le" }].map(String::from));
    if aac {
        a.extend(["-b:a", "320k", "-movflags", "+faststart"].map(String::from));
    }
    a.push(out.into());
    a
}

/// Put the Audio engine's recording (`wav`, from `ae_tap_stop`) under a real-time
/// recording `video` in place: `offset` seconds later than the picture, mixed with
/// the video's own sound when `mix`. The WAV is removed afterwards.
#[tauri::command]
async fn mux_recording_audio(video: String, wav: String, offset: f64, mix: bool) -> Result<(), String> {
    ffmpeg_sidecar::download::auto_download().map_err(|e| e.to_string())?;
    let ffmpeg_path = ffmpeg_sidecar::paths::ffmpeg_path();
    let vp = std::path::Path::new(&video);
    if !vp.is_file() || !std::path::Path::new(&wav).is_file() {
        return Err("The recording or the engine's sound file is missing".into());
    }
    let ext = vp.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    let stem = vp.file_stem().and_then(|s| s.to_str()).unwrap_or("recording");
    let out = vp.with_file_name(format!("{stem}.engine-mix.{ext}"));
    let out_s = out.to_string_lossy().into_owned();
    let status = Command::new(&ffmpeg_path)
        .args(mux_args(&video, &wav, if offset.is_finite() { offset.clamp(-5.0, 5.0) } else { 0.0 }, mix, &out_s))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run FFmpeg: {e}"))?;
    let _ = std::fs::remove_file(&wav);
    if !status.status.success() {
        let _ = std::fs::remove_file(&out);
        let msg = String::from_utf8_lossy(&status.stderr);
        return Err(format!("FFmpeg couldn't add the engine's sound: {}", msg.lines().last().unwrap_or("").trim()));
    }
    std::fs::rename(&out, vp).map_err(|e| format!("Couldn't replace the recording: {e}"))
}

#[cfg(test)]
mod mux_tests {
    use super::mux_args;

    #[test]
    fn mixes_with_the_video_s_own_sound_or_takes_the_track_over() {
        let a = mux_args("/v/a.mp4", "/t/e.wav", 0.0125, true, "/v/a.engine-mix.mp4");
        assert!(a.windows(2).any(|w| w == ["-itsoffset", "0.0125"]));
        assert!(a.iter().any(|x| x.contains("amix=inputs=2")));
        assert!(a.windows(2).any(|w| w == ["-c:v", "copy"]) && a.windows(2).any(|w| w == ["-c:a", "aac"]));
        let b = mux_args("/v/a.mov", "/t/e.wav", -0.5, false, "/v/a.engine-mix.mov");
        assert!(b.windows(2).any(|w| w == ["-map", "1:a:0"]) && b.contains(&"-shortest".to_string()));
        assert!(b.windows(2).any(|w| w == ["-c:a", "pcm_s16le"]));
        assert!(!b.iter().any(|x| x.contains("amix")));
    }
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

/// Open an http(s):// address in the system browser (credit and note links: the
/// webview itself ignores target="_blank").
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) || url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"') {
        return Err("Only http(s):// addresses can be opened".into());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(FfmpegState(Mutex::new(None)))
        .manage(OscState(Mutex::new(None)))
        .manage(midi::MidiState::default())
        .manage(audio_engine::EngineState::default())
        .manage(workspace::WatchState(Mutex::new(None)))
        .manage(linked::LinkedState::default())
        .manage(playfile::OpenedFiles(Mutex::new(Vec::new())))
        .manage(output_window::OutputState::default())
        .invoke_handler(tauri::generate_handler![
            start_ffmpeg_encode,
            send_frame_rgba,
            stop_ffmpeg_encode,
            osc_start,
            osc_stop,
            midi::midi_list,
            midi::midi_open_input,
            midi::midi_close_input,
            midi::midi_open_output,
            midi::midi_close_output,
            midi::midi_send,
            audio_engine::ae_status,
            audio_engine::ae_units,
            audio_engine::ae_rack_create,
            audio_engine::ae_rack_remove,
            audio_engine::ae_rack_volume,
            audio_engine::ae_set_instrument,
            audio_engine::ae_set_sampler,
            audio_engine::ae_sound_has,
            audio_engine::ae_sound_put,
            audio_engine::ae_sampler_zone,
            audio_engine::ae_effect_insert,
            audio_engine::ae_effect_remove,
            audio_engine::ae_effect_move,
            audio_engine::ae_bypass,
            audio_engine::ae_params,
            audio_engine::ae_param_set,
            audio_engine::ae_state_get,
            audio_engine::ae_state_set,
            audio_engine::ae_midi,
            audio_engine::ae_outputs,
            audio_engine::ae_set_output,
            audio_engine::ae_master,
            audio_engine::ae_open_ui,
            audio_engine::ae_rack_input,
            audio_engine::ae_rack_feed,
            audio_engine::ae_rack_input_stats,
            audio_engine::ae_render_input,
            audio_engine::ae_render_take,
            audio_engine::ae_tap_start,
            audio_engine::ae_tap_stop,
            audio_engine::ae_tap_discard,
            mux_recording_audio,
            open_url,
            data_fetch::fetch_url,
            data_fetch::kaggle_account,
            data_fetch::kaggle_save,
            data_fetch::kaggle_forget,
            workspace::ws_probe,
            workspace::ws_create_root,
            workspace::ws_list,
            workspace::ws_read,
            workspace::ws_write,
            workspace::ws_remove,
            workspace::ws_watch,
            workspace::ws_unwatch,
            workspace::ws_reveal,
            linked::lf_set_roots,
            linked::lf_probe,
            linked::lf_list,
            linked::lf_stat,
            linked::lf_read,
            linked::lf_watch,
            linked::lf_unwatch,
            playfile::opened_files_take,
            playfile::open_file_read,
            playfile::signing_key_get,
            playfile::signing_key_save,
            output_window::output_monitors,
            output_window::output_open,
            output_window::output_close,
            output_window::output_fullscreen,
            output_window::output_record_put,
            output_window::output_record_get,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // A .playfile opened with the app (Finder, the Dock): kept for the web side to take
            // at launch, and announced for when it's already running (src/playfile.rs).
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = &_event {
                use tauri::Manager;
                let paths = playfile::container_paths(urls);
                if !paths.is_empty() {
                    if let Ok(mut v) = _app.state::<playfile::OpenedFiles>().0.lock() {
                        v.extend(paths.iter().cloned());
                    }
                    let _ = _app.emit("open-files", paths);
                }
            }
        });
}
