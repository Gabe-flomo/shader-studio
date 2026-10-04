//! Bake (docs/bake.md): a part of the graph rendered offline to a video that
//! comes back as a Baked node. FFmpeg writes the file to a temporary path
//! (`bake_temp_path`), the app reads it once into its video library
//! (`bake_take_file`, which also removes it), and nothing is left behind.
//! Only files this module named can be read or removed through it.

use std::path::{Path, PathBuf};

const PREFIX: &str = "playfield-bake-";

/// FFmpeg's video arguments for a bake: H.264 at high quality, a keyframe every
/// half second and no B-frames, so a player can seek to any frame quickly and
/// every browser and WebKit decode it in hardware. The colours are converted
/// with BT.709 at limited range and tagged so (sRGB transfer), so WebKit
/// doesn't guess the matrix from the frame size or shift the gamma.
pub fn bake_codec_args(fps: u32) -> Vec<String> {
    let gop = (fps / 2).max(1).to_string();
    [
        "-vf", "scale=out_color_matrix=bt709:out_range=tv",
        "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-profile:v", "high",
        "-g", &gop, "-keyint_min", &gop, "-sc_threshold", "0", "-bf", "0",
        "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-color_range", "tv",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

fn bake_dir() -> PathBuf {
    std::env::temp_dir()
}

/// Is `path` a file this module named (in the temp folder, with our prefix, no tricks)?
pub fn is_bake_path(path: &Path, dir: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return false };
    if !name.starts_with(PREFIX) || name.contains("..") || name.contains('/') || name.contains('\\') {
        return false;
    }
    match (path.parent().and_then(|p| p.canonicalize().ok()), dir.canonicalize().ok()) {
        (Some(p), Some(d)) => p == d,
        _ => false,
    }
}

/// A fresh temporary path for a bake's file, with extension `ext` (mp4, mov…).
#[tauri::command]
pub fn bake_temp_path(ext: String) -> Result<String, String> {
    if ext.is_empty() || ext.len() > 5 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Unsupported extension".into());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = bake_dir().join(format!("{PREFIX}{}-{stamp}.{ext}", std::process::id()));
    Ok(path.to_string_lossy().into_owned())
}

/// Read a finished bake's file into the app (as raw bytes, no size cap) and remove it.
#[tauri::command]
pub fn bake_take_file(path: String) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    if !is_bake_path(&p, &bake_dir()) {
        return Err("Not a bake file".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("Couldn't read the baked video: {e}"))?;
    let _ = std::fs::remove_file(&p);
    Ok(tauri::ipc::Response::new(bytes))
}

/// Remove a bake's temporary file (a cancelled or failed bake).
#[tauri::command]
pub fn bake_discard_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if is_bake_path(&p, &bake_dir()) {
        let _ = std::fs::remove_file(&p);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn h264_with_short_gops_and_no_b_frames() {
        let a = bake_codec_args(30);
        assert!(a.windows(2).any(|w| w == ["-c:v", "libx264"]));
        assert!(a.windows(2).any(|w| w == ["-g", "15"]));
        assert!(a.windows(2).any(|w| w == ["-bf", "0"]));
        assert!(a.windows(2).any(|w| w == ["-pix_fmt", "yuv420p"]));
        assert!(a.windows(2).any(|w| w == ["-colorspace", "bt709"]));
        assert!(a.windows(2).any(|w| w == ["-vf", "scale=out_color_matrix=bt709:out_range=tv"]));
        assert!(bake_codec_args(1).windows(2).any(|w| w == ["-g", "1"]));
    }

    #[test]
    fn only_its_own_temp_files() {
        let dir = std::env::temp_dir();
        let ours = bake_temp_path("mp4".into()).unwrap();
        std::fs::write(&ours, b"x").unwrap();
        assert!(is_bake_path(Path::new(&ours), &dir));
        assert!(!is_bake_path(&dir.join("other.mp4"), &dir));
        assert!(!is_bake_path(Path::new("/etc/playfield-bake-1.mp4"), &dir));
        assert!(bake_temp_path("../x".into()).is_err());
        let _ = std::fs::remove_file(&ours);
    }
}
