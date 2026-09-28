//! touch.rs — "touch to configure" (docs/audio-engine.md, Configure): while
//! Configure is on for a slot, the native side reports every parameter
//! change (an AUParameterTree observer, plus a diff of all values against a
//! snapshot for units that don't tell observers) and what the person did in
//! the slot's plug-in window (clicks, drags, scrolls). This decides which
//! changes are the person touching a control, and so become rack controls.
//!
//! A change is a touch when it lands while the button is held in the window,
//! or within a second of a click, drag or scroll there. A parameter that
//! moves while nobody is touching it (an LFO, a meter the unit marks
//! writable, a value the plug-in animates) is "restless" and never offered
//! in this watch. When the window's events can't be seen at all (some
//! out-of-process views), a change counts unless the parameter was already
//! moving in the first second, before anyone could touch it. Many new
//! parameters moving at once is a preset or a randomise: none are offered.
//!
//! Pure: a drained batch in, touches out.

use serde::Deserialize;
use std::collections::{HashMap, HashSet};

/// The event the page's Configure listens for.
pub const TOUCH_EVENT: &str = "audio-engine:param-touched";
/// The first this-many seconds of a watch: nobody has touched the window yet.
pub const SETTLE_S: f64 = 1.0;
/// A change up to this long after a click, drag or scroll in the window is the person's (s).
pub const AFTER_EVENT_S: f64 = 1.0;
/// … or this long before one (a value can land before its event is noted) (s).
pub const BEFORE_EVENT_S: f64 = 0.15;
/// A held button (its release unseen: a control's own tracking loop) counts for at most this long (s).
pub const HELD_MAX_S: f64 = 30.0;
/// More than this many new parameters moving in one batch: a preset change, not a touch.
pub const BURST: usize = 3;
/// A parameter that moved this many times with nobody touching is restless.
pub const RESTLESS_AFTER: u32 = 2;

/// One change the native side saw: address, value, seconds since the watch began.
#[derive(Deserialize, Clone, Debug)]
pub struct RawChange {
    pub a: String,
    pub v: f32,
    pub t: f64,
}

/// A watched slot's drain (native/audio_engine.m, `ae_watch_drain`). Times are seconds since the watch began.
#[derive(Deserialize, Clone, Debug)]
pub struct Batch {
    pub rack: String,
    pub slot: String,
    #[serde(default)]
    pub changes: Vec<RawChange>,
    /// Clicks, drags and scrolls in the plug-in's own area, newest last.
    #[serde(default)]
    pub events: Vec<f64>,
    /// The last button press and release there.
    #[serde(default)]
    pub down: Option<f64>,
    #[serde(default)]
    pub up: Option<f64>,
    /// The slot's unit went (removed, replaced): the watch ended.
    #[serde(default)]
    pub gone: bool,
}

impl Batch {
    /// Has the window's activity been seen at all? (If not, the view keeps its events to itself.)
    pub fn known(&self) -> bool {
        !self.events.is_empty() || self.down.is_some()
    }

    /// Was the person touching the window at `t`?
    pub fn active_at(&self, t: f64) -> bool {
        if self.events.iter().any(|&e| t >= e - BEFORE_EVENT_S && t <= e + AFTER_EVENT_S) {
            return true;
        }
        match self.down {
            Some(d) => {
                let released = self.up.is_some_and(|u| u >= d);
                !released && t >= d - BEFORE_EVENT_S && t - d <= HELD_MAX_S
            }
            None => false,
        }
    }
}

/// A parameter the person touched: its newest value in the batch; `first` the first time in this watch.
#[derive(Clone, Debug, PartialEq)]
pub struct Touch {
    pub address: u64,
    pub value: f32,
    pub first: bool,
}

#[derive(Default)]
pub struct TouchWatch {
    unattributed: HashMap<u64, u32>,
    restless: HashSet<u64>,
    touched: HashSet<u64>,
}

impl TouchWatch {
    pub fn take(&mut self, b: &Batch) -> Vec<Touch> {
        // One entry per parameter: its newest value, when it first moved, whether any move was the person's.
        let mut order: Vec<u64> = vec![];
        let mut by: HashMap<u64, (f32, f64, bool)> = HashMap::new();
        for c in &b.changes {
            let Ok(a) = c.a.parse::<u64>() else { continue };
            if !c.v.is_finite() || !c.t.is_finite() {
                continue;
            }
            let active = b.active_at(c.t);
            match by.get_mut(&a) {
                Some(e) => {
                    e.0 = c.v;
                    e.1 = e.1.min(c.t);
                    e.2 |= active;
                }
                None => {
                    order.push(a);
                    by.insert(a, (c.v, c.t, active));
                }
            }
        }
        let known = b.known();
        let mut accepted: Vec<(u64, f32)> = vec![];
        for a in order {
            let (v, t0, active) = by[&a];
            if self.restless.contains(&a) {
                continue;
            }
            if !active && (known || t0 < SETTLE_S) {
                // Nobody touched it. A control already taken may still be settling after its gesture: leave it be.
                if !self.touched.contains(&a) {
                    let n = self.unattributed.entry(a).or_insert(0);
                    *n += 1;
                    if *n >= RESTLESS_AFTER || t0 < SETTLE_S {
                        self.restless.insert(a);
                    }
                }
                continue;
            }
            accepted.push((a, v));
        }
        let fresh = accepted.iter().filter(|(a, _)| !self.touched.contains(a)).count();
        let burst = fresh > BURST;
        let mut out = vec![];
        for (a, v) in accepted {
            let first = !self.touched.contains(&a);
            if first && burst {
                continue;
            }
            if first {
                self.touched.insert(a);
            }
            out.push(Touch { address: a, value: v, first });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(changes: &[(&str, f32, f64)], events: &[f64], down: Option<f64>, up: Option<f64>) -> Batch {
        Batch {
            rack: "rk".into(),
            slot: "inst".into(),
            changes: changes.iter().map(|&(a, v, t)| RawChange { a: a.into(), v, t }).collect(),
            events: events.to_vec(),
            down,
            up,
            gone: false,
        }
    }

    #[test]
    fn a_drag_in_the_window_is_a_touch_with_its_newest_value() {
        let mut w = TouchWatch::default();
        let b = batch(&[("7", 0.2, 3.0), ("7", 0.3, 3.02), ("7", 0.35, 3.03)], &[2.99, 3.01], Some(2.99), None);
        assert_eq!(w.take(&b), vec![Touch { address: 7, value: 0.35, first: true }]);
        // The same control again: not first any more.
        let b = batch(&[("7", 0.5, 3.1)], &[3.09], Some(2.99), None);
        assert_eq!(w.take(&b), vec![Touch { address: 7, value: 0.5, first: false }]);
    }

    #[test]
    fn a_held_button_counts_until_released() {
        // The press is seen, then the control's own tracking loop hides the drags.
        let held = batch(&[("3", 1.0, 8.0)], &[2.0], Some(2.0), None);
        assert!(held.active_at(8.0));
        let mut w = TouchWatch::default();
        assert_eq!(w.take(&held).len(), 1);
        // Released at 2.5: a move at 8 s is nobody's.
        let released = batch(&[("4", 1.0, 8.0)], &[2.0, 2.5], Some(2.0), Some(2.5));
        assert!(!released.active_at(8.0));
        assert!(released.active_at(3.2), "within a second of the release");
        assert!(w.take(&released).is_empty());
    }

    #[test]
    fn a_parameter_that_moves_on_its_own_is_never_offered() {
        let mut w = TouchWatch::default();
        // The window's events are seen (a click at 1.5 s), and an LFO'd parameter moves at 5 s and 6 s.
        assert!(w.take(&batch(&[("9", 0.1, 5.0)], &[1.5], Some(1.5), Some(1.6))).is_empty());
        assert!(w.take(&batch(&[("9", 0.2, 6.0)], &[1.5], Some(1.5), Some(1.6))).is_empty());
        // Now the person clicks while it moves: still not offered, it's restless.
        assert!(w.take(&batch(&[("9", 0.3, 7.0)], &[7.0], Some(7.0), None)).is_empty());
        // Another parameter touched at the same time is.
        assert_eq!(w.take(&batch(&[("9", 0.4, 7.1), ("2", 0.5, 7.1)], &[7.05], Some(7.0), None)), vec![Touch { address: 2, value: 0.5, first: true }]);
    }

    #[test]
    fn with_no_window_events_moves_after_the_first_second_count() {
        let mut w = TouchWatch::default();
        // A parameter already moving in the first second is restless.
        assert!(w.take(&batch(&[("1", 0.1, 0.4)], &[], None, None)).is_empty());
        assert!(w.take(&batch(&[("1", 0.2, 4.0)], &[], None, None)).is_empty());
        // One that starts moving later (nothing seen in the window) is taken as a touch.
        assert_eq!(w.take(&batch(&[("5", 0.7, 4.0)], &[], None, None)), vec![Touch { address: 5, value: 0.7, first: true }]);
    }

    #[test]
    fn a_preset_change_is_not_a_touch() {
        let mut w = TouchWatch::default();
        let many: Vec<(String, f32, f64)> = (0..12).map(|i| (i.to_string(), 0.5, 4.0)).collect();
        let refs: Vec<(&str, f32, f64)> = many.iter().map(|(a, v, t)| (a.as_str(), *v, *t)).collect();
        assert!(w.take(&batch(&refs, &[3.9], Some(3.9), Some(3.95))).is_empty());
        // An XY pad (two at once) is fine.
        assert_eq!(w.take(&batch(&[("20", 0.1, 6.0), ("21", 0.9, 6.0)], &[5.95], Some(5.95), None)).len(), 2);
    }

    #[test]
    fn a_touched_control_settling_after_its_gesture_stays_offered() {
        let mut w = TouchWatch::default();
        assert_eq!(w.take(&batch(&[("7", 0.2, 3.0)], &[3.0], Some(3.0), Some(3.1))).len(), 1);
        // The plug-in's own smoothing lands it at 5 s and 6 s (nobody touching): ignored, not made restless.
        assert!(w.take(&batch(&[("7", 0.21, 5.0)], &[3.0], Some(3.0), Some(3.1))).is_empty());
        assert!(w.take(&batch(&[("7", 0.22, 6.0)], &[3.0], Some(3.0), Some(3.1))).is_empty());
        assert_eq!(w.take(&batch(&[("7", 0.6, 9.0)], &[8.95], Some(8.95), None)), vec![Touch { address: 7, value: 0.6, first: false }]);
    }

    #[test]
    fn junk_is_skipped_and_drains_parse() {
        let mut w = TouchWatch::default();
        assert!(w.take(&batch(&[("x", 0.2, 3.0), ("4", f32::NAN, 3.0)], &[3.0], None, None)).is_empty());
        let json = r#"[{"rack":"rk_1","slot":"fx_2","now":3.2,"changes":[{"a":"12","v":0.5,"t":3.1}],"events":[3.05],"down":3.0,"up":null,"gone":false},
                      {"rack":"rk_1","slot":"inst","now":1.0,"changes":[],"events":[],"down":null,"up":null,"gone":true}]"#;
        let b: Vec<Batch> = serde_json::from_str(json).unwrap();
        assert_eq!(b.len(), 2);
        assert!(b[1].gone);
        assert_eq!(w.take(&b[0]), vec![Touch { address: 12, value: 0.5, first: true }]);
    }
}
