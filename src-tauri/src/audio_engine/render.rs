//! render.rs — a take's racks rendered offline: the page sends the racks as
//! they are (units, presets, parameter values, sample player zones), the
//! notes the take recorded (`ae:<rack>` pad actions as MIDI bytes) and its
//! parameter automation as timed steps; this builds the racks again in the
//! engine's offline render context (manual rendering mode, nothing heard),
//! replays the events at their exact sample and renders stereo PCM the page
//! puts under the video's other sounds (src/lib/engineRender.ts).
//!
//! Replay is sample-exact: the render runs up to each event's sample, applies
//! every event due there (immediate MIDI / parameter set), then runs on
//! (`schedule`). A rack fed by a web sound (`input`) gets that sound's PCM,
//! uploaded before the render (`ae_render_input`), as its source.
//!
//! The reply is bytes (a Tauri `Response`): a little-endian u32 JSON length,
//! the JSON (`RenderInfo`), then the left channel as f32 LE, then the right.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::ffi;
use super::UnitRef;

/// The longest run between event checks (also the native render's chunk).
pub const MAX_CHUNK: u32 = 4096;
/// A render runs at most this long (a take is a minute; a little tail for reverbs).
pub const MAX_SECONDS: f64 = 90.0;
pub const RENDER_PREFIX: &str = "render:";

#[derive(Deserialize, Debug, Clone)]
pub struct ZoneSpec {
    pub sound: String,
    pub lo: i32,
    pub hi: i32,
    pub root: i32,
    pub gain: f32,
}

#[derive(Deserialize, Debug, Clone)]
pub struct SlotSpec {
    pub id: String,
    /// An Audio Unit…
    pub unit: Option<UnitRef>,
    /// …or the sample player with these zones.
    pub zones: Option<Vec<ZoneSpec>>,
    #[serde(default)]
    pub bypass: bool,
    /// The unit's preset (base64 plist), put back before its parameter values.
    pub state: Option<String>,
    #[serde(default)]
    pub params: HashMap<String, f32>,
    /// For the page: the unit's name, in notes about it.
    #[serde(default)]
    pub name: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct RackSpec {
    pub id: String,
    pub name: String,
    pub instrument: Option<SlotSpec>,
    #[serde(default)]
    pub effects: Vec<SlotSpec>,
    #[serde(default = "one")]
    pub volume: f32,
    #[serde(default)]
    pub mute: bool,
    /// Its source is a web sound the page uploaded with `ae_render_input` (instead of the instrument).
    #[serde(default)]
    pub input: bool,
}

fn one() -> f32 {
    1.0
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct NoteEvent {
    /// Seconds into the render.
    pub t: f64,
    pub rack: String,
    /// One MIDI channel message (2–3 bytes).
    pub bytes: Vec<u8>,
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct ParamEvent {
    pub t: f64,
    pub rack: String,
    pub slot: String,
    pub address: String,
    pub value: f32,
}

#[derive(Deserialize, Debug, Clone)]
pub struct RenderJob {
    #[serde(rename = "sampleRate")]
    pub sample_rate: f64,
    pub seconds: f64,
    pub racks: Vec<RackSpec>,
    #[serde(default)]
    pub events: Vec<NoteEvent>,
    #[serde(default)]
    pub params: Vec<ParamEvent>,
}

/// What comes back with the PCM.
#[derive(Serialize, Debug, Clone, Default, PartialEq)]
pub struct RenderInfo {
    #[serde(rename = "sampleRate")]
    pub sample_rate: f64,
    pub frames: u32,
    /// Seconds of latency each rack's units report, by rack id (the page slides the sound earlier by the largest).
    pub latency: HashMap<String, f64>,
    /// Anything left out or approximate: a unit that wouldn't load offline, a missing sound.
    pub notes: Vec<String>,
    /// The racks that made it into the render.
    pub racks: Vec<String>,
}

// ── Scheduling (pure) ────────────────────────────────────────────────────────

/// One leg of the render: run `frames` frames, then apply the events at indices `then` (into the sorted event list).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub frames: u32,
    pub then: Vec<usize>,
}

/// Seconds → the sample the event lands on (rounded to the nearest frame, never before 0).
pub fn sample_of(t: f64, sample_rate: f64) -> u64 {
    if !t.is_finite() || t <= 0.0 {
        0
    } else {
        (t * sample_rate).round() as u64
    }
}

/// Sort event times (samples) into legs: render up to each distinct time, apply
/// everything due there, never more than `max_chunk` frames at a stretch, and
/// finish at `total`. Events at or past `total` are dropped (nothing would hear them).
pub fn schedule(times: &[u64], total: u64, max_chunk: u32) -> Vec<Step> {
    let max = max_chunk.max(1) as u64;
    let mut order: Vec<usize> = (0..times.len()).filter(|&i| times[i] < total).collect();
    order.sort_by_key(|&i| times[i]);
    let mut out = vec![];
    let mut at = 0u64;
    let mut k = 0;
    // Events already due at 0 go first, before any frame renders.
    let mut first = vec![];
    while k < order.len() && times[order[k]] == 0 {
        first.push(order[k]);
        k += 1;
    }
    if !first.is_empty() {
        out.push(Step { frames: 0, then: first });
    }
    while k < order.len() || at < total {
        let next = if k < order.len() { times[order[k]] } else { total };
        while at < next {
            let n = (next - at).min(max);
            at += n;
            let due = at == next && k < order.len();
            let mut then = vec![];
            if due {
                while k < order.len() && times[order[k]] == at {
                    then.push(order[k]);
                    k += 1;
                }
            }
            out.push(Step { frames: n as u32, then });
        }
    }
    out
}

/// One event of either kind, in sample time.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Midi { rack: String, bytes: Vec<u8> },
    Param { rack: String, slot: String, address: u64, value: f32 },
}

/// The job's notes and parameter steps as one list with their samples (unsorted; `schedule` orders them).
pub fn events_of(job: &RenderJob) -> (Vec<u64>, Vec<Event>) {
    let mut times = vec![];
    let mut events = vec![];
    for e in &job.events {
        if e.bytes.is_empty() || e.bytes.len() > 3 {
            continue;
        }
        times.push(sample_of(e.t, job.sample_rate));
        events.push(Event::Midi { rack: e.rack.clone(), bytes: e.bytes.clone() });
    }
    for p in &job.params {
        let Ok(address) = p.address.parse::<u64>() else { continue };
        times.push(sample_of(p.t, job.sample_rate));
        events.push(Event::Param { rack: p.rack.clone(), slot: p.slot.clone(), address, value: p.value });
    }
    (times, events)
}

/// The frames a job renders (its seconds at its rate, capped).
pub fn total_frames(job: &RenderJob) -> u64 {
    let secs = if job.seconds.is_finite() { job.seconds.clamp(0.0, MAX_SECONDS) } else { 0.0 };
    (secs * job.sample_rate).ceil() as u64
}

/// The reply bytes: u32 LE JSON length, the JSON, left f32 LE, right f32 LE.
pub fn pack_reply(info: &RenderInfo, left: &[f32], right: &[f32]) -> Vec<u8> {
    let json = serde_json::to_vec(info).unwrap_or_else(|_| b"{}".to_vec());
    let mut out = Vec::with_capacity(4 + json.len() + (left.len() + right.len()) * 4);
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    for s in left.iter().chain(right.iter()) {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

// ── Running it ───────────────────────────────────────────────────────────────

pub fn rid(id: &str) -> String {
    format!("{RENDER_PREFIX}{id}")
}

/// Build one rack in the render context. Notes collect what didn't load; a rack with no source at all is skipped (false).
fn build_rack(r: &RackSpec, sound_path: &dyn Fn(&str) -> Option<String>, inputs: &mut HashMap<String, Vec<f32>>, total: u64, notes: &mut Vec<String>) -> Result<bool, String> {
    let id = rid(&r.id);
    ffi::rack_create(&id)?;
    ffi::rack_volume(&id, r.volume, r.mute)?;
    let mut has_source = false;
    if r.input {
        match inputs.remove(&r.id) {
            Some(pcm) => {
                ffi::set_input(&id, (total as u32).saturating_add(MAX_CHUNK * 2))?;
                ffi::feed(&id, &pcm)?;
                has_source = true;
            }
            None => notes.push(format!("{}: its sound from the page wasn't uploaded, so the rack is silent in this render", r.name)),
        }
    } else if let Some(inst) = &r.instrument {
        if let Some(zones) = &inst.zones {
            ffi::set_sampler(&id)?;
            has_source = true;
            for (i, z) in zones.iter().enumerate() {
                match sound_path(&z.sound) {
                    Some(p) => {
                        if let Err(e) = ffi::sampler_zone(&id, i as i32, &p, z.lo, z.hi, z.root, z.gain) {
                            notes.push(format!("{}: a sample player sound didn't load ({e})", r.name));
                        }
                    }
                    None => notes.push(format!("{}: a sample player sound isn't cached for the engine, so it's silent here", r.name)),
                }
            }
        } else if let Some(u) = inst.unit {
            match ffi::set_instrument(&id, Some(u.triple())) {
                Ok(()) => {
                    has_source = true;
                    apply_slot(&id, inst, notes, &r.name);
                }
                Err(e) => notes.push(format!("{}: {} couldn't load offline ({e}); record it in real time instead", r.name, slot_name(inst))),
            }
        }
    }
    if !has_source {
        ffi::rack_remove(&id)?;
        return Ok(false);
    }
    let mut index = 0;
    for fx in &r.effects {
        let Some(u) = fx.unit else { continue };
        match ffi::effect_insert(&id, &fx.id, index, u.triple()) {
            Ok(()) => {
                index += 1;
                if fx.bypass {
                    let _ = ffi::bypass(&id, &fx.id, true);
                }
                apply_slot(&id, fx, notes, &r.name);
            }
            Err(e) => notes.push(format!("{}: {} couldn't load offline ({e}); it's left out of this render", r.name, slot_name(fx))),
        }
    }
    Ok(true)
}

fn slot_name(s: &SlotSpec) -> String {
    if !s.name.is_empty() { s.name.clone() } else { "an Audio Unit".into() }
}

/// The slot's preset, then its parameter values.
fn apply_slot(id: &str, s: &SlotSpec, notes: &mut Vec<String>, rack: &str) {
    if let Some(st) = &s.state {
        if let Err(e) = ffi::state_set(id, &s.id, st) {
            notes.push(format!("{rack}: {}'s saved settings didn't load ({e})", slot_name(s)));
        }
    }
    for (address, value) in &s.params {
        if let Ok(a) = address.parse::<u64>() {
            let _ = ffi::param_set(id, &s.id, a, *value);
        }
    }
}

/// Render the job. `sound_path` resolves a cached Library sound by id; `inputs` are uploaded web sounds by rack id (taken).
pub fn run(job: &RenderJob, sound_path: &dyn Fn(&str) -> Option<String>, mut inputs: HashMap<String, Vec<f32>>) -> Result<(RenderInfo, Vec<f32>, Vec<f32>), String> {
    if !(job.sample_rate >= 8000.0 && job.sample_rate <= 192_000.0) {
        return Err("Not a sample rate the engine renders at".into());
    }
    let total = total_frames(job);
    if total == 0 {
        return Err("Nothing to render".into());
    }
    ffi::render_open(job.sample_rate)?;
    let out = (|| {
        let mut info = RenderInfo { sample_rate: job.sample_rate, frames: total as u32, ..Default::default() };
        let mut built = std::collections::HashSet::new();
        for r in &job.racks {
            if build_rack(r, sound_path, &mut inputs, total, &mut info.notes)? {
                built.insert(r.id.clone());
                info.racks.push(r.id.clone());
                let lat = ffi::rack_latency(&rid(&r.id));
                if lat > 0.0 {
                    info.latency.insert(r.id.clone(), lat);
                }
            }
        }
        if built.is_empty() {
            return Err("None of the racks could be rendered".to_string());
        }
        let (times, events) = events_of(job);
        let mut left = vec![0.0f32; total as usize];
        let mut right = vec![0.0f32; total as usize];
        let mut at = 0usize;
        for step in schedule(&times, total, MAX_CHUNK) {
            let n = step.frames as usize;
            if n > 0 {
                let got = ffi::render_stereo(&mut left[at..at + n], &mut right[at..at + n])?;
                at += got;
                if got < n {
                    return Err("The render stopped early".to_string());
                }
            }
            for i in step.then {
                match &events[i] {
                    Event::Midi { rack, bytes } if built.contains(rack) => {
                        let _ = ffi::midi(&rid(rack), bytes[0], bytes.get(1).copied().unwrap_or(0), bytes.get(2).copied().unwrap_or(0));
                    }
                    Event::Param { rack, slot, address, value } if built.contains(rack) => {
                        let _ = ffi::param_set(&rid(rack), slot, *address, *value);
                    }
                    _ => {}
                }
            }
        }
        Ok((info, left, right))
    })();
    ffi::render_close();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(events: Vec<NoteEvent>, params: Vec<ParamEvent>) -> RenderJob {
        RenderJob { sample_rate: 48000.0, seconds: 1.0, racks: vec![], events, params }
    }

    #[test]
    fn samples_round_to_the_nearest_frame_and_never_go_negative() {
        assert_eq!(sample_of(0.5, 48000.0), 24000);
        assert_eq!(sample_of(1.0 / 48000.0 * 10.4, 48000.0), 10);
        assert_eq!(sample_of(-1.0, 48000.0), 0);
        assert_eq!(sample_of(f64::NAN, 48000.0), 0);
    }

    #[test]
    fn schedule_renders_up_to_each_event_then_applies_it() {
        // Two notes at 100 and 250, total 400, chunks of 1000: 100 frames, note, 150 frames, note, 150 frames.
        let s = schedule(&[250, 100], 400, 1000);
        assert_eq!(s, vec![Step { frames: 100, then: vec![1] }, Step { frames: 150, then: vec![0] }, Step { frames: 150, then: vec![] }]);
        assert_eq!(s.iter().map(|x| x.frames as u64).sum::<u64>(), 400);
    }

    #[test]
    fn schedule_splits_long_runs_and_groups_events_at_one_sample() {
        let s = schedule(&[5000, 5000, 9000], 9000, 4096);
        // 4096, 904 (then both events), 4000 (then nothing: the event at 9000 is at the end and dropped).
        assert_eq!(s.iter().map(|x| x.frames).collect::<Vec<_>>(), vec![4096, 904, 4000]);
        assert_eq!(s[1].then, vec![0, 1]);
        assert!(s[2].then.is_empty());
        assert_eq!(s.iter().map(|x| x.frames as u64).sum::<u64>(), 9000);
    }

    #[test]
    fn events_at_zero_come_before_any_frame_and_late_ones_are_dropped() {
        let s = schedule(&[0, 0, 700], 500, 4096);
        assert_eq!(s[0], Step { frames: 0, then: vec![0, 1] });
        assert_eq!(s[1], Step { frames: 500, then: vec![] });
        assert_eq!(s.len(), 2);
        // No events at all: one straight run, chunked.
        let plain = schedule(&[], 10000, 4096);
        assert_eq!(plain.iter().map(|x| x.frames).collect::<Vec<_>>(), vec![4096, 4096, 1808]);
        assert!(plain.iter().all(|x| x.then.is_empty()));
    }

    #[test]
    fn events_keep_notes_and_parameter_steps_with_their_samples() {
        let j = job(
            vec![NoteEvent { t: 0.5, rack: "rk".into(), bytes: vec![0x90, 60, 100] }, NoteEvent { t: 0.1, rack: "rk".into(), bytes: vec![] }],
            vec![ParamEvent { t: 0.25, rack: "rk".into(), slot: "fx".into(), address: "7".into(), value: 0.5 }, ParamEvent { t: 0.3, rack: "rk".into(), slot: "fx".into(), address: "x".into(), value: 1.0 }],
        );
        let (times, events) = events_of(&j);
        assert_eq!(times, vec![24000, 12000]);
        assert_eq!(events[0], Event::Midi { rack: "rk".into(), bytes: vec![0x90, 60, 100] });
        assert_eq!(events[1], Event::Param { rack: "rk".into(), slot: "fx".into(), address: 7, value: 0.5 });
        assert_eq!(total_frames(&j), 48000);
        assert_eq!(total_frames(&RenderJob { seconds: 1000.0, ..j.clone() }), (MAX_SECONDS * 48000.0) as u64);
    }

    #[test]
    fn the_job_reads_the_page_s_shape() {
        let j: RenderJob = serde_json::from_str(r#"{"sampleRate":44100,"seconds":2.5,"racks":[{"id":"rk_a","name":"Rack 1","instrument":{"id":"inst","unit":{"type":1635085685,"subtype":1684828960,"manufacturer":1634758764},"params":{"3":0.5},"name":"DLSMusicDevice"},"effects":[{"id":"fx_d","unit":{"type":1,"subtype":2,"manufacturer":3},"bypass":true}],"volume":0.8},{"id":"rk_s","name":"Sampler","instrument":{"id":"inst","zones":[{"sound":"snd1","lo":36,"hi":36,"root":36,"gain":1}]}},{"id":"rk_i","name":"Send","instrument":null,"input":true}],"events":[{"t":0.5,"rack":"rk_a","bytes":[144,60,100]}],"params":[{"t":1,"rack":"rk_a","slot":"fx_d","address":"7","value":0.25}]}"#).unwrap();
        assert_eq!(j.racks.len(), 3);
        assert_eq!(j.racks[0].instrument.as_ref().unwrap().params["3"], 0.5);
        assert!(j.racks[0].effects[0].bypass);
        assert_eq!(j.racks[0].volume, 0.8);
        assert_eq!(j.racks[1].volume, 1.0);
        assert_eq!(j.racks[1].instrument.as_ref().unwrap().zones.as_ref().unwrap()[0].sound, "snd1");
        assert!(j.racks[2].input);
        assert_eq!(j.events[0].bytes, vec![0x90, 60, 100]);
    }

    #[test]
    fn the_reply_packs_json_then_both_channels() {
        let info = RenderInfo { sample_rate: 48000.0, frames: 2, latency: HashMap::new(), notes: vec!["n".into()], racks: vec!["rk".into()] };
        let b = pack_reply(&info, &[0.5, -0.5], &[1.0, 0.0]);
        let len = u32::from_le_bytes(b[0..4].try_into().unwrap()) as usize;
        let j: serde_json::Value = serde_json::from_slice(&b[4..4 + len]).unwrap();
        assert_eq!(j["frames"], 2);
        assert_eq!(j["notes"][0], "n");
        let pcm: Vec<f32> = b[4 + len..].chunks(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect();
        assert_eq!(pcm, vec![0.5, -0.5, 1.0, 0.0]);
    }
}
