//! analysis.rs — a rack's output as the page's audio readers want it: the
//! same spectrum a Web Audio AnalyserNode gives (Blackman window, |X| / N,
//! smoothed between frames, in dB), plus a short waveform, packed small for
//! a Tauri event.
//!
//! Packing (src/lib/audioEngineProtocol.ts decodes it):
//!   bins  base64, one byte per FFT bin: dB = byte / 2 + DB_FLOOR (−130 … −2.5 dB, ½ dB steps)
//!   wave  base64, one byte per sample: sample = (byte − 128) / 127

use base64::Engine as _;
use serde::Serialize;

pub const FFT_SIZE: usize = 2048;
pub const BINS: usize = FFT_SIZE / 2;
pub const WAVE_POINTS: usize = 512;
pub const DB_FLOOR: f32 = -130.0;
/// Web Audio's default is 0.8 a frame at 60 fps; frames here come about 33 times a second.
pub const SMOOTHING: f32 = 0.67;

/// One frame for the page, as the `audio-engine://frame` event.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Frame {
    pub rack: String,
    #[serde(rename = "sampleRate")]
    pub sample_rate: f64,
    pub bins: String,
    pub wave: String,
    /// RMS and peak of the analysed block, 0..1.
    pub rms: f32,
    pub peak: f32,
}

/// dB → one byte.
pub fn pack_db(db: f32) -> u8 {
    if !db.is_finite() {
        return 0;
    }
    ((db - DB_FLOOR) * 2.0).round().clamp(0.0, 255.0) as u8
}

#[cfg(test)]
pub fn unpack_db(b: u8) -> f32 {
    b as f32 / 2.0 + DB_FLOOR
}

/// A sample (−1..1) → one byte.
pub fn pack_sample(s: f32) -> u8 {
    if !s.is_finite() {
        return 128;
    }
    (s.clamp(-1.0, 1.0) * 127.0 + 128.0).round().clamp(0.0, 255.0) as u8
}

fn blackman(n: usize) -> Vec<f32> {
    // Web Audio's: a = 0.16, a0 = 0.42, a1 = 0.5, a2 = 0.08.
    let len = n as f32;
    (0..n)
        .map(|i| {
            let x = i as f32 / len;
            0.42 - 0.5 * (2.0 * std::f32::consts::PI * x).cos() + 0.08 * (4.0 * std::f32::consts::PI * x).cos()
        })
        .collect()
}

/// In-place radix-2 FFT (re, im); `re.len()` a power of two.
pub fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    debug_assert!(n.is_power_of_two() && im.len() == n);
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f64::consts::PI / len as f64;
        let (wr, wi) = (ang.cos() as f32, ang.sin() as f32);
        let mut i = 0;
        while i < n {
            let (mut cr, mut ci) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let (a, b) = (i + k, i + k + len / 2);
                let tr = re[b] * cr - im[b] * ci;
                let ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
            i += len;
        }
        len <<= 1;
    }
}

/// A rack's analyser: keeps the smoothed magnitudes between frames.
pub struct Analyser {
    window: Vec<f32>,
    smoothed: Vec<f32>,
    re: Vec<f32>,
    im: Vec<f32>,
}

impl Default for Analyser {
    fn default() -> Self {
        Self { window: blackman(FFT_SIZE), smoothed: vec![0.0; BINS], re: vec![0.0; FFT_SIZE], im: vec![0.0; FFT_SIZE] }
    }
}

impl Analyser {
    /// The spectrum of the newest FFT_SIZE samples, in dB per bin (smoothed like an AnalyserNode).
    pub fn spectrum_db(&mut self, samples: &[f32]) -> Vec<f32> {
        let off = samples.len().saturating_sub(FFT_SIZE);
        for i in 0..FFT_SIZE {
            let s = samples.get(off + i).copied().unwrap_or(0.0);
            self.re[i] = if s.is_finite() { s } else { 0.0 } * self.window[i];
            self.im[i] = 0.0;
        }
        fft(&mut self.re, &mut self.im);
        let scale = 1.0 / FFT_SIZE as f32;
        (0..BINS)
            .map(|k| {
                let mag = (self.re[k] * self.re[k] + self.im[k] * self.im[k]).sqrt() * scale;
                let v = SMOOTHING * self.smoothed[k] + (1.0 - SMOOTHING) * mag;
                self.smoothed[k] = if v.is_finite() { v } else { 0.0 };
                20.0 * self.smoothed[k].max(1e-12).log10()
            })
            .collect()
    }

    /// A whole frame for the page.
    pub fn frame(&mut self, rack: &str, samples: &[f32], sample_rate: f64) -> Frame {
        let db = self.spectrum_db(samples);
        let bins: Vec<u8> = db.iter().map(|&d| pack_db(d)).collect();
        let tail = &samples[samples.len().saturating_sub(WAVE_POINTS)..];
        let wave: Vec<u8> = tail.iter().map(|&s| pack_sample(s)).collect();
        let block = &samples[samples.len().saturating_sub(FFT_SIZE)..];
        let (mut sum, mut peak) = (0.0f32, 0.0f32);
        for &s in block {
            if s.is_finite() {
                sum += s * s;
                peak = peak.max(s.abs());
            }
        }
        let rms = if block.is_empty() { 0.0 } else { (sum / block.len() as f32).sqrt() };
        let b64 = base64::engine::general_purpose::STANDARD;
        Frame { rack: rack.to_string(), sample_rate, bins: b64.encode(bins), wave: b64.encode(wave), rms, peak: peak.min(1.0) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(hz: f32, sr: f32, n: usize, amp: f32) -> Vec<f32> {
        (0..n).map(|i| amp * (2.0 * std::f32::consts::PI * hz * i as f32 / sr).sin()).collect()
    }

    #[test]
    fn db_packing_round_trips_in_half_db_steps() {
        for db in [-130.0, -100.0, -60.5, -30.0, -10.0, -3.0] {
            assert!((unpack_db(pack_db(db)) - db).abs() <= 0.25, "{db}");
        }
        assert_eq!(pack_db(-200.0), 0);
        assert_eq!(pack_db(10.0), 255);
        assert_eq!(pack_db(f32::NAN), 0);
    }

    #[test]
    fn sample_packing_is_centred() {
        assert_eq!(pack_sample(0.0), 128);
        assert_eq!(pack_sample(1.0), 255);
        assert_eq!(pack_sample(-1.0), 1);
        assert_eq!(pack_sample(5.0), 255);
        assert_eq!(pack_sample(f32::INFINITY), 128);
    }

    #[test]
    fn fft_finds_a_sine_bin() {
        let sr = 48000.0;
        // Bin 64 exactly: 64 × 48000 / 2048 = 1500 Hz.
        let mut a = Analyser::default();
        let mut db = vec![];
        for _ in 0..30 {
            db = a.spectrum_db(&sine(1500.0, sr, FFT_SIZE, 0.5));
        }
        let peak = db.iter().enumerate().max_by(|x, y| x.1.partial_cmp(y.1).unwrap()).unwrap().0;
        assert_eq!(peak, 64);
        // A 0.5 sine through a Blackman window, |X|/N: 0.5 × 0.42 / 2 ≈ 0.105 → about −19.6 dB (as Web Audio reads it).
        assert!((db[64] - (-19.6)).abs() < 1.0, "{}", db[64]);
        // Far from the tone it is far quieter.
        assert!(db[400] < db[64] - 60.0);
    }

    #[test]
    fn silence_reads_the_floor() {
        let mut a = Analyser::default();
        let f = a.frame("r1", &vec![0.0; FFT_SIZE], 48000.0);
        let bins = base64::engine::general_purpose::STANDARD.decode(&f.bins).unwrap();
        assert_eq!(bins.len(), BINS);
        assert!(bins.iter().all(|&b| b == 0));
        let wave = base64::engine::general_purpose::STANDARD.decode(&f.wave).unwrap();
        assert_eq!(wave.len(), WAVE_POINTS);
        assert!(wave.iter().all(|&b| b == 128));
        assert_eq!(f.rms, 0.0);
    }

    #[test]
    fn frame_serialises_for_the_page() {
        let mut a = Analyser::default();
        let f = a.frame("rk_a", &sine(440.0, 48000.0, FFT_SIZE, 0.25), 48000.0);
        let v = serde_json::to_value(&f).unwrap();
        assert_eq!(v["rack"], "rk_a");
        assert_eq!(v["sampleRate"], 48000.0);
        assert!(v["bins"].is_string() && v["wave"].is_string());
        assert!((f.peak - 0.25).abs() < 0.01);
        assert!((f.rms - 0.25 / 2f32.sqrt()).abs() < 0.01);
    }

    #[test]
    fn short_input_is_padded_at_the_front() {
        let mut a = Analyser::default();
        let f = a.frame("r", &[0.5; 10], 44100.0);
        let wave = base64::engine::general_purpose::STANDARD.decode(&f.wave).unwrap();
        assert_eq!(wave.len(), 10);
    }
}
