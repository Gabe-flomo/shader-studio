//! tap.rs — the live engine's sound for a real-time recording. The native
//! side taps the main mixer into a ring (native/audio_engine.m, `ae_tap_*`);
//! the worker thread drains the ring every tick into a `TapCollector`, which
//! writes a 16-bit stereo WAV as it goes. Each drain says which frame it
//! starts at, so a drain that comes too late (the ring lapped) leaves a hole
//! of silence rather than a jump: the file stays lined up with the clock.
//!
//! The page muxes the file into the recording (lib.rs `mux_recording_audio`)
//! shifted by the tap's start offset (docs/audio-engine.md).

use std::io::{Seek, SeekFrom, Write};

/// A tick drains at most this many frames (a fifth of a second at 48 kHz; the ring holds 2.7 s).
pub const DRAIN_FRAMES: usize = 9600;

pub struct TapCollector<W: Write + Seek> {
    out: W,
    sample_rate: u32,
    /// Frames written to the file so far (= the next frame expected).
    frames: u64,
    /// Frames that never arrived (filled with silence).
    lost: u64,
    header_done: bool,
}

fn wav_header(sample_rate: u32, frames: u64) -> [u8; 44] {
    let data = (frames * 4).min(u32::MAX as u64 - 36) as u32;
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data).to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&2u16.to_le_bytes()); // stereo
    h[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    h[28..32].copy_from_slice(&(sample_rate * 4).to_le_bytes());
    h[32..34].copy_from_slice(&4u16.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data.to_le_bytes());
    h
}

impl<W: Write + Seek> TapCollector<W> {
    pub fn new(out: W, sample_rate: u32) -> Self {
        Self { out, sample_rate, frames: 0, lost: 0, header_done: false }
    }

    fn ensure_header(&mut self) -> std::io::Result<()> {
        if !self.header_done {
            self.out.write_all(&wav_header(self.sample_rate, 0))?;
            self.header_done = true;
        }
        Ok(())
    }

    /// Frames from the ring: `from` is the frame count of the first one, `pcm` interleaved stereo.
    pub fn push(&mut self, from: u64, pcm: &[f32]) -> std::io::Result<()> {
        self.ensure_header()?;
        let n = (pcm.len() / 2) as u64;
        if n == 0 {
            return Ok(());
        }
        let mut pcm = pcm;
        let mut from = from;
        if from < self.frames {
            // Overlap (shouldn't happen): keep only what's new.
            let skip = (self.frames - from).min(n) as usize;
            pcm = &pcm[skip * 2..];
            from = self.frames;
            if pcm.is_empty() {
                return Ok(());
            }
        }
        if from > self.frames {
            let gap = from - self.frames;
            self.lost += gap;
            let zeros = vec![0u8; 4096];
            let mut left = gap * 4;
            while left > 0 {
                let k = left.min(zeros.len() as u64) as usize;
                self.out.write_all(&zeros[..k])?;
                left -= k as u64;
            }
            self.frames = from;
        }
        let mut bytes = Vec::with_capacity(pcm.len() * 2);
        for s in pcm {
            let v = if s.is_finite() { (s.clamp(-1.0, 1.0) * 32767.0).round() as i16 } else { 0 };
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        self.out.write_all(&bytes)?;
        self.frames += (pcm.len() / 2) as u64;
        Ok(())
    }

    #[cfg(test)]
    pub fn lost(&self) -> u64 {
        self.lost
    }

    /// Patch the header with the final sizes; (frames, lost frames).
    pub fn finish(mut self) -> std::io::Result<(u64, u64, W)> {
        self.ensure_header()?;
        self.out.flush()?;
        self.out.seek(SeekFrom::Start(0))?;
        self.out.write_all(&wav_header(self.sample_rate, self.frames))?;
        self.out.flush()?;
        Ok((self.frames, self.lost, self.out))
    }
}

/// The tap's start offset in seconds: how long after it was installed its first buffer was rendered (0 while unknown).
pub fn start_offset(install_ns: u64, first_ns: u64) -> f64 {
    if first_ns == 0 || install_ns == 0 || first_ns < install_ns {
        0.0
    } else {
        ((first_ns - install_ns) as f64 / 1e9).min(0.5)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn samples(bytes: &[u8]) -> Vec<i16> {
        bytes[44..].chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()
    }

    #[test]
    fn writes_a_wav_with_the_final_sizes() {
        let mut c = TapCollector::new(Cursor::new(vec![]), 48000);
        c.push(0, &[0.5, -0.5, 1.0, -1.0]).unwrap();
        let (frames, lost, out) = c.finish().unwrap();
        assert_eq!((frames, lost), (2, 0));
        let b = out.into_inner();
        assert_eq!(&b[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(b[4..8].try_into().unwrap()), 36 + 8);
        assert_eq!(u16::from_le_bytes(b[22..24].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(b[24..28].try_into().unwrap()), 48000);
        assert_eq!(u32::from_le_bytes(b[40..44].try_into().unwrap()), 8);
        assert_eq!(samples(&b), vec![16384, -16384, 32767, -32767]);
    }

    #[test]
    fn a_late_drain_leaves_silence_where_frames_were_lost() {
        let mut c = TapCollector::new(Cursor::new(vec![]), 48000);
        c.push(0, &[0.1, 0.1]).unwrap();
        // The ring lapped: the next drain starts at frame 3, so frames 1 and 2 are silence.
        c.push(3, &[0.2, 0.2]).unwrap();
        assert_eq!(c.lost(), 2);
        let (frames, lost, out) = c.finish().unwrap();
        assert_eq!((frames, lost), (4, 2));
        let s = samples(&out.into_inner());
        assert_eq!(s.len(), 8);
        assert_eq!(&s[2..6], &[0, 0, 0, 0]);
        assert_eq!(s[6], (0.2f32 * 32767.0).round() as i16);
    }

    #[test]
    fn an_overlapping_drain_keeps_only_the_new_frames() {
        let mut c = TapCollector::new(Cursor::new(vec![]), 44100);
        c.push(0, &[0.1, 0.1, 0.2, 0.2]).unwrap();
        c.push(1, &[0.9, 0.9, 0.3, 0.3]).unwrap();
        let (frames, _, out) = c.finish().unwrap();
        assert_eq!(frames, 3);
        let s = samples(&out.into_inner());
        assert_eq!(s[4], (0.3f32 * 32767.0).round() as i16);
    }

    #[test]
    fn an_empty_tap_still_makes_a_valid_file() {
        let c = TapCollector::new(Cursor::new(vec![]), 48000);
        let (frames, _, out) = c.finish().unwrap();
        assert_eq!(frames, 0);
        assert_eq!(out.into_inner().len(), 44);
    }

    #[test]
    fn start_offset_is_the_wait_for_the_first_buffer() {
        assert_eq!(start_offset(1_000_000_000, 1_012_000_000), 0.012);
        assert_eq!(start_offset(5, 0), 0.0);
        assert_eq!(start_offset(10, 5), 0.0);
        assert_eq!(start_offset(0, 5_000_000_000), 0.0);
        assert_eq!(start_offset(1, 3_000_000_001), 0.5);
    }
}
