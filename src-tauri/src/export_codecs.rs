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
        "h264" => vec!["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p"],
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

#[cfg(test)]
mod tests {
    use super::*;

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
