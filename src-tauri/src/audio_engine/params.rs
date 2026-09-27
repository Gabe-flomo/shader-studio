//! params.rs — Audio Unit parameters as the page shows them, and the
//! smoothing that glides a mapped parameter to its new value.
//!
//! The native side lists each parameter's raw AudioUnitParameterUnit and
//! flags; `describe` turns those into what the rack card needs: a unit label,
//! a kind (number, toggle, list), a step, and whether to show it on a log
//! scale. On the page a parameter is the control target
//! `au:<rack>:<slot>::<address>` (src/types/playAudioEngine.ts).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A parameter as audio_engine.m lists it.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct RawParam {
    pub address: String,
    #[serde(default)]
    pub identifier: String,
    pub name: String,
    pub min: f32,
    pub max: f32,
    pub value: f32,
    pub unit: i32,
    #[serde(default, rename = "unitName")]
    pub unit_name: String,
    #[serde(default)]
    pub flags: u32,
    #[serde(default)]
    pub values: Option<Vec<String>>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Param {
    pub address: String,
    pub identifier: String,
    pub name: String,
    pub min: f32,
    pub max: f32,
    pub value: f32,
    /// "Hz", "dB", "%", "ms"… or "".
    pub unit: String,
    /// "number", "toggle" or "list".
    pub kind: &'static str,
    /// 0 = continuous.
    pub step: f32,
    /// Shown (and mapped best) on a log scale: frequencies, times the plug-in marks so.
    pub log: bool,
    /// A list parameter's choices, from `min`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<String>>,
}

const FLAG_DISPLAY_LOG: u32 = 1 << 22;

/// AudioUnitParameterUnit → (label, kind, step).
pub fn unit_info(unit: i32, unit_name: &str) -> (String, &'static str, f32) {
    let (label, kind, step): (&str, &'static str, f32) = match unit {
        1 => ("", "list", 1.0),          // Indexed
        2 => ("", "toggle", 1.0),        // Boolean
        3 => ("%", "number", 0.0),       // Percent
        4 => ("s", "number", 0.0),       // Seconds
        5 => ("samples", "number", 1.0), // SampleFrames
        6 => ("°", "number", 0.0),       // Phase
        7 => ("×", "number", 0.0),       // Rate
        8 => ("Hz", "number", 0.0),      // Hertz
        9 => ("cents", "number", 0.0),   // Cents
        10 => ("st", "number", 0.0),     // RelativeSemiTones
        11 => ("note", "number", 1.0),   // MIDINoteNumber
        12 => ("", "number", 1.0),       // MIDIController
        13 => ("dB", "number", 0.0),     // Decibels
        14 => ("", "number", 0.0),       // LinearGain
        15 => ("°", "number", 0.0),      // Degrees
        18 => ("pan", "number", 0.0),    // Pan
        20 => ("cents", "number", 0.0),  // AbsoluteCents
        21 => ("oct", "number", 0.0),    // Octaves
        22 => ("BPM", "number", 0.0),    // BPM
        23 => ("beats", "number", 0.0),  // Beats
        24 => ("ms", "number", 0.0),     // Milliseconds
        25 => (":1", "number", 0.0),     // Ratio
        26 => (unit_name, "number", 0.0), // CustomUnit
        _ => ("", "number", 0.0),
    };
    (label.to_string(), kind, step)
}

pub fn describe(raw: RawParam) -> Param {
    let (unit, mut kind, step) = unit_info(raw.unit, &raw.unit_name);
    let values = raw.values.filter(|v| !v.is_empty());
    if values.is_some() && kind == "number" {
        kind = "list";
    }
    let (min, max) = if raw.min <= raw.max { (raw.min, raw.max) } else { (raw.max, raw.min) };
    let log = (raw.flags & FLAG_DISPLAY_LOG != 0 || raw.unit == 8) && min > 0.0 && kind == "number";
    Param {
        address: raw.address,
        identifier: raw.identifier,
        name: raw.name,
        min,
        max,
        value: raw.value.clamp(min, max),
        unit,
        kind,
        step: if kind == "number" { step } else { 1.0 },
        log,
        values,
    }
}

/// The native side's JSON → parameters for the page (ones it can't read are left out).
pub fn parse_params(json: &str) -> Vec<Param> {
    serde_json::from_str::<Vec<serde_json::Value>>(json)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| serde_json::from_value::<RawParam>(v).ok())
        .filter(|p| p.address.parse::<u64>().is_ok() && p.min.is_finite() && p.max.is_finite())
        .map(describe)
        .collect()
}

/// Where a parameter lives: rack, slot ("inst" or an effect's id), address.
pub type ParamKey = (String, String, u64);

/// Mapped parameters glide to their targets (a knob never zips or clicks);
/// lists and toggles jump.
#[derive(Default)]
pub struct Smoother {
    live: HashMap<ParamKey, (f32, f32)>,
}

/// Time constant of the glide, in seconds.
pub const GLIDE_S: f32 = 0.03;

impl Smoother {
    /// A new target. Returns the value to set right away (a first value, or a jump), or None to glide.
    pub fn set(&mut self, key: ParamKey, target: f32, smooth: bool) -> Option<f32> {
        if !target.is_finite() {
            return None;
        }
        match self.live.get_mut(&key) {
            Some(v) if smooth => {
                v.1 = target;
                None
            }
            _ => {
                self.live.insert(key, (target, target));
                Some(target)
            }
        }
    }

    /// One step of `dt` seconds: the parameters that moved and their new values.
    pub fn step(&mut self, dt: f32) -> Vec<(ParamKey, f32)> {
        let k = 1.0 - (-dt.max(0.0) / GLIDE_S).exp();
        let mut out = vec![];
        for (key, (cur, target)) in self.live.iter_mut() {
            if cur == target {
                continue;
            }
            let span = (*target - *cur).abs();
            *cur = if span < 1e-4 * target.abs().max(1.0) { *target } else { *cur + (*target - *cur) * k };
            out.push((key.clone(), *cur));
        }
        out
    }

    /// Forget a rack's parameters (it was removed), or one slot's.
    pub fn forget(&mut self, rack: &str, slot: Option<&str>) {
        self.live.retain(|(r, s, _), _| !(r == rack && slot.map_or(true, |x| x == s)));
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.live.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(unit: i32, flags: u32, min: f32, max: f32) -> RawParam {
        RawParam { address: "7".into(), identifier: "cutoff".into(), name: "Cutoff".into(), min, max, value: 1000.0, unit, unit_name: "".into(), flags, values: None }
    }

    #[test]
    fn hertz_is_a_log_number() {
        let p = describe(raw(8, 0, 10.0, 22050.0));
        assert_eq!((p.unit.as_str(), p.kind, p.log, p.step), ("Hz", "number", true, 0.0));
    }

    #[test]
    fn a_log_flag_needs_a_positive_range() {
        assert!(describe(raw(0, FLAG_DISPLAY_LOG, 0.01, 10.0)).log);
        assert!(!describe(raw(0, FLAG_DISPLAY_LOG, -1.0, 10.0)).log);
    }

    #[test]
    fn indexed_and_boolean() {
        let mut r = raw(1, 0, 0.0, 3.0);
        r.values = Some(vec!["Sine".into(), "Saw".into(), "Square".into(), "Noise".into()]);
        let p = describe(r);
        assert_eq!((p.kind, p.step), ("list", 1.0));
        assert_eq!(p.values.as_ref().unwrap().len(), 4);
        let t = describe(raw(2, 0, 0.0, 1.0));
        assert_eq!(t.kind, "toggle");
        // Value strings on a generic parameter make it a list too.
        let mut g = raw(0, 0, 0.0, 1.0);
        g.values = Some(vec!["Off".into(), "On".into()]);
        assert_eq!(describe(g).kind, "list");
    }

    #[test]
    fn custom_units_keep_their_name_and_ranges_are_ordered() {
        let mut r = raw(26, 0, 5.0, -5.0);
        r.unit_name = "semis".into();
        r.value = 9.0;
        let p = describe(r);
        assert_eq!(p.unit, "semis");
        assert_eq!((p.min, p.max, p.value), (-5.0, 5.0, 5.0));
    }

    #[test]
    fn parse_skips_what_it_cannot_read() {
        let json = r#"[
          {"address":"0","identifier":"a","name":"Gain","min":-40,"max":40,"value":0,"unit":13,"unitName":"","flags":3221225472},
          {"address":"x","name":"Bad","min":0,"max":1,"value":0,"unit":0},
          {"name":"No address","min":0,"max":1,"value":0,"unit":0},
          {"address":"18446744073709551615","name":"Big","min":0,"max":1,"value":0.5,"unit":0}
        ]"#;
        let ps = parse_params(json);
        assert_eq!(ps.len(), 2);
        assert_eq!(ps[0].unit, "dB");
        assert_eq!(ps[1].address, "18446744073709551615");
        assert!(parse_params("not json").is_empty());
    }

    #[test]
    fn smoother_sets_first_then_glides() {
        let mut s = Smoother::default();
        let k: ParamKey = ("r".into(), "fx1".into(), 3);
        assert_eq!(s.set(k.clone(), 100.0, true), Some(100.0));
        assert_eq!(s.set(k.clone(), 200.0, true), None);
        let a = s.step(0.01);
        assert_eq!(a.len(), 1);
        assert!(a[0].1 > 100.0 && a[0].1 < 200.0);
        for _ in 0..200 {
            s.step(0.01);
        }
        assert!(s.step(0.01).is_empty(), "settled");
        // A jump (a list, a toggle) is set at once.
        assert_eq!(s.set(k.clone(), 1.0, false), Some(1.0));
        assert!(s.step(0.01).is_empty());
        assert_eq!(s.set(k, f32::NAN, true), None);
    }

    #[test]
    fn smoother_forgets_racks_and_slots() {
        let mut s = Smoother::default();
        s.set(("a".into(), "inst".into(), 1), 1.0, true);
        s.set(("a".into(), "fx".into(), 1), 1.0, true);
        s.set(("b".into(), "inst".into(), 1), 1.0, true);
        s.forget("a", Some("fx"));
        assert_eq!(s.len(), 2);
        s.forget("a", None);
        assert_eq!(s.len(), 1);
    }
}
