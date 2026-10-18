//! FFmpeg output arguments for the Record dialog's codecs (start_ffmpeg_encode).
//!
//! No dependencies, so the tests run with plain `rustc --test src-tauri/src/export_codecs.rs`.
//! The ProRes ids mirror src/utils/prores.ts (PRORES_PROFILES); a vitest reads this file
//! to keep the two in step.

/// The video codec arguments for `codec`, or None for one this module doesn't know
/// ("bake" has its own, in bake.rs). Unknown names fall back to H.264 in the caller.
///
/// prores_ks profiles: 0 Proxy, 1 LT, 2 422 (standard), 3 422 HQ, 4 4444, 5 4444 XQ.
/// The 4444 pair reads the frames' alpha (rawvideo rgba in) into a 16-bit alpha plane.
pub fn video_codec_args(codec: &str) -> Option<Vec<&'static str>> {
    let prores = |profile: &'static str, pix_fmt: &'static str, alpha: bool| {
        let mut a = vec!["-c:v", "prores_ks", "-profile:v", profile, "-vendor", "apl0", "-pix_fmt", pix_fmt];
        if alpha {
            a.extend(["-alpha_bits", "16"]);
        }
        a
    };
    Some(match codec {
        "prores_proxy" => prores("0", "yuv422p10le", false),
        "prores_lt" => prores("1", "yuv422p10le", false),
        "prores_422" => prores("2", "yuv422p10le", false),
        // "prores" is 422 HQ (the name from before the profiles).
        "prores" => prores("3", "yuv422p10le", false),
        "prores4444" => prores("4", "yuva444p10le", true),
        "prores4444xq" => prores("5", "yuva444p10le", true),
        "ffv1" => vec!["-c:v", "ffv1", "-level", "3", "-coder", "1", "-context", "1", "-pix_fmt", "yuv420p"],
        // x264 at medium: within a few percent of slow's size at CRF 18, about twice as fast.
        "h264" => vec!["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"],
        _ => return None,
    })
}

/// Is this one of the ProRes codecs (a .mov, PCM sound)?
pub fn is_prores(codec: &str) -> bool {
    matches!(codec, "prores" | "prores_proxy" | "prores_lt" | "prores_422" | "prores4444" | "prores4444xq")
}

/// The audio codec arguments for a recording's sound in `codec`'s container.
pub fn audio_codec_args(codec: &str) -> &'static [&'static str] {
    if is_prores(codec) {
        &["-c:a", "pcm_s16le"]
    } else if codec == "ffv1" {
        &["-c:a", "flac"]
    } else {
        &["-c:a", "aac", "-b:a", "320k"]
    }
}

// ── The MP4's encoder (the Record dialog's Speed choice) ─────────────────────────────────────────────

/// The hardware encoders the Speed choice can use (Apple VideoToolbox), as FFmpeg names them.
pub const HARDWARE_ENCODERS: [&str; 2] = ["h264_videotoolbox", "hevc_videotoolbox"];

/// FFmpeg's encoder for an MP4 `encoder` choice: "hardware" (VideoToolbox H.264), "hardware_hevc"
/// (VideoToolbox HEVC, smaller files), anything else x264 (the best compression, the slowest).
pub fn mp4_encoder_name(encoder: &str) -> &'static str {
    match encoder {
        "hardware" => "h264_videotoolbox",
        "hardware_hevc" => "hevc_videotoolbox",
        _ => "libx264",
    }
}

/// The bitrate (bits a second) a hardware encode gets so it looks like x264 at CRF 18: VideoToolbox has
/// no CRF, so the rate scales with the pixels a second, 0.2 bits a pixel for H.264 and 0.12 for HEVC
/// (about 25 Mb/s for 1080p60 H.264), kept between 4 and 160 Mb/s.
pub fn hardware_bitrate(width: u32, height: u32, fps: u32, hevc: bool) -> u64 {
    let px = width as f64 * height as f64 * fps.max(1) as f64;
    let bpp = if hevc { 0.12 } else { 0.2 };
    ((px * bpp) as u64).clamp(4_000_000, 160_000_000)
}

/// The MP4's video arguments for an `encoder` choice (see mp4_encoder_name).
pub fn mp4_encoder_args(encoder: &str, width: u32, height: u32, fps: u32) -> Vec<String> {
    let name = mp4_encoder_name(encoder);
    if name == "libx264" {
        return video_codec_args("h264").unwrap().into_iter().map(String::from).collect();
    }
    let hevc = name.starts_with("hevc");
    let rate = hardware_bitrate(width, height, fps, hevc);
    let mut a: Vec<String> = vec!["-c:v".into(), name.into(), "-b:v".into(), rate.to_string()];
    // Peaks up to 1.5× the rate, over two seconds' worth of buffer.
    a.extend(["-maxrate".to_string(), (rate * 3 / 2).to_string(), "-bufsize".to_string(), (rate * 2).to_string()]);
    a.extend(["-pix_fmt".to_string(), "yuv420p".to_string()]);
    if hevc {
        // QuickTime and Finder previews play HEVC only tagged hvc1.
        a.extend(["-tag:v".to_string(), "hvc1".to_string()]);
    } else {
        a.extend(["-profile:v".to_string(), "high".to_string()]);
    }
    a
}

/// Which of HARDWARE_ENCODERS an `ffmpeg -encoders` listing has (a row is " V..... h264_videotoolbox  …").
pub fn listed_hardware_encoders(listing: &str) -> Vec<String> {
    HARDWARE_ENCODERS
        .iter()
        .filter(|name| listing.lines().any(|l| l.split_whitespace().nth(1) == Some(**name)))
        .map(|s| s.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned_pair(a: &[String], k: &str) -> Option<String> {
        a.windows(2).find(|w| w[0] == k).map(|w| w[1].clone())
    }

    #[test]
    fn x264_runs_at_medium() {
        let a = video_codec_args("h264").unwrap();
        assert_eq!(pair(&a, "-preset").as_deref(), Some("medium"));
        assert_eq!(pair(&a, "-crf").as_deref(), Some("18"));
    }

    #[test]
    fn the_mp4_encoder_choice() {
        let x = mp4_encoder_args("x264", 1920, 1080, 60);
        assert_eq!(owned_pair(&x, "-c:v").as_deref(), Some("libx264"));
        assert_eq!(owned_pair(&x, "-preset").as_deref(), Some("medium"));
        // Anything unknown is x264.
        assert_eq!(mp4_encoder_name("auto"), "libx264");

        let h = mp4_encoder_args("hardware", 1920, 1080, 60);
        assert_eq!(owned_pair(&h, "-c:v").as_deref(), Some("h264_videotoolbox"));
        assert_eq!(owned_pair(&h, "-b:v").as_deref(), Some("24883200"));
        assert_eq!(owned_pair(&h, "-maxrate").as_deref(), Some("37324800"));
        assert_eq!(owned_pair(&h, "-pix_fmt").as_deref(), Some("yuv420p"));
        assert_eq!(owned_pair(&h, "-profile:v").as_deref(), Some("high"));
        assert!(owned_pair(&h, "-crf").is_none());

        let v = mp4_encoder_args("hardware_hevc", 3840, 2160, 30);
        assert_eq!(owned_pair(&v, "-c:v").as_deref(), Some("hevc_videotoolbox"));
        assert_eq!(owned_pair(&v, "-tag:v").as_deref(), Some("hvc1"));
        assert_eq!(owned_pair(&v, "-b:v").as_deref(), Some("29859840"));
    }

    #[test]
    fn hardware_bitrate_scales_and_stays_in_range() {
        assert_eq!(hardware_bitrate(64, 64, 30, false), 4_000_000);
        assert_eq!(hardware_bitrate(7680, 4320, 120, false), 160_000_000);
        assert!(hardware_bitrate(1920, 1080, 30, true) < hardware_bitrate(1920, 1080, 30, false));
    }

    #[test]
    fn reads_the_hardware_encoders_from_the_listing() {
        let listing = "Encoders:\n V..... = Video\n ------\n V....D libx264              libx264 H.264\n V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)\n V....D hevc_videotoolbox_x  not this\n";
        assert_eq!(listed_hardware_encoders(listing), vec!["h264_videotoolbox".to_string()]);
        assert!(listed_hardware_encoders("").is_empty());
    }

    fn pair(a: &[&str], k: &str) -> Option<String> {
        a.windows(2).find(|w| w[0] == k).map(|w| w[1].to_string())
    }

    #[test]
    fn each_prores_profile_has_its_id_and_pixel_format() {
        let cases = [
            ("prores_proxy", "0", "yuv422p10le"),
            ("prores_lt", "1", "yuv422p10le"),
            ("prores_422", "2", "yuv422p10le"),
            ("prores", "3", "yuv422p10le"),
            ("prores4444", "4", "yuva444p10le"),
            ("prores4444xq", "5", "yuva444p10le"),
        ];
        for (codec, profile, pix) in cases {
            let a = video_codec_args(codec).unwrap();
            assert_eq!(pair(&a, "-c:v").as_deref(), Some("prores_ks"), "{codec}");
            assert_eq!(pair(&a, "-profile:v").as_deref(), Some(profile), "{codec}");
            assert_eq!(pair(&a, "-pix_fmt").as_deref(), Some(pix), "{codec}");
            assert_eq!(pair(&a, "-alpha_bits").is_some(), pix.starts_with("yuva"), "{codec}");
            assert!(is_prores(codec));
            assert_eq!(audio_codec_args(codec), &["-c:a", "pcm_s16le"]);
        }
    }

    #[test]
    fn the_others_are_unchanged() {
        assert_eq!(pair(&video_codec_args("h264").unwrap(), "-c:v").as_deref(), Some("libx264"));
        assert_eq!(pair(&video_codec_args("ffv1").unwrap(), "-c:v").as_deref(), Some("ffv1"));
        assert!(video_codec_args("bake").is_none());
        assert_eq!(audio_codec_args("ffv1"), &["-c:a", "flac"]);
        assert_eq!(audio_codec_args("h264")[1], "aac");
    }
}
