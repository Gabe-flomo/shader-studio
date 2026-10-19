//! Pairing IDs: one per instance, unique inside Live's process.
//!
//! Live hosts every plugin in one process, so a registry in this dylib sees every Playfield Send.
//! A duplicated track copies the plugin's state, ID included: the copy finds its ID taken and keeps
//! a fresh one instead (the instance then tells Live, see plugin.rs `setState`). Main thread only:
//! the registry takes a lock, which the audio thread never does.

use std::sync::Mutex;

use pfsend_protocol::PAIRING_MAX;

/// New IDs are four digits, so they read the same everywhere ("4821", never "42").
const NEW_MIN: u32 = 1000;

static CLAIMED: Mutex<Vec<(u32, usize)>> = Mutex::new(Vec::new());

fn lock() -> std::sync::MutexGuard<'static, Vec<(u32, usize)>> {
    // A poisoned lock only means a panic elsewhere held it; the list itself is still fine.
    CLAIMED.lock().unwrap_or_else(|e| e.into_inner())
}

/// A small random number generator seeded from the clock and the instance (no `rand` crate).
pub struct Rng(u64);

impl Rng {
    pub fn new(salt: u64) -> Self {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
        Rng((t ^ salt.rotate_left(17) ^ (std::process::id() as u64) << 32) | 1)
    }
    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
}

/// What a claim did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Claim {
    pub id: u32,
    /// The wanted ID was taken by another instance, so this one got a fresh ID.
    pub rerolled: bool,
}

/// Take `wanted` for `owner` (an instance's address), or a fresh free ID when it is taken or absent.
/// The owner's previous ID is released.
pub fn claim(owner: usize, wanted: Option<u32>, rng: &mut Rng) -> Claim {
    let mut list = lock();
    list.retain(|&(_, o)| o != owner);
    let taken = |id: u32, list: &Vec<(u32, usize)>| list.iter().any(|&(i, _)| i == id);
    if let Some(w) = wanted.filter(|w| *w <= PAIRING_MAX) {
        if !taken(w, &list) {
            list.push((w, owner));
            return Claim { id: w, rerolled: false };
        }
    }
    let span = (PAIRING_MAX - NEW_MIN + 1) as u64;
    let mut id = NEW_MIN + (rng.next() % span) as u32;
    // At most 9000 can be taken; walk on from a random start until one is free.
    for _ in 0..=span {
        if !taken(id, &list) {
            break;
        }
        id = if id >= PAIRING_MAX { NEW_MIN } else { id + 1 };
    }
    list.push((id, owner));
    Claim { id, rerolled: wanted.is_some() }
}

/// Give the owner's ID back (the instance is going away).
pub fn release(owner: usize) {
    lock().retain(|&(_, o)| o != owner);
}

/// Normalized parameter value ↔ ID (the parameter has 9999 steps).
pub fn id_to_normalized(id: u32) -> f64 {
    id.min(PAIRING_MAX) as f64 / PAIRING_MAX as f64
}

pub fn normalized_to_id(v: f64) -> u32 {
    (v.clamp(0.0, 1.0) * PAIRING_MAX as f64).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_duplicate_rerolls_and_a_release_frees() {
        let mut rng = Rng::new(1);
        let a = claim(0xA0, Some(4821), &mut rng);
        assert_eq!(a, Claim { id: 4821, rerolled: false });
        // The duplicated track's copy wants the same ID.
        let b = claim(0xB0, Some(4821), &mut rng);
        assert!(b.rerolled);
        assert_ne!(b.id, 4821);
        assert!((NEW_MIN..=PAIRING_MAX).contains(&b.id));
        // Claiming again for the same owner replaces its own claim (not "taken by itself").
        assert_eq!(claim(0xA0, Some(4821), &mut rng).id, 4821);
        release(0xA0);
        assert_eq!(claim(0xC0, Some(4821), &mut rng), Claim { id: 4821, rerolled: false });
        // A fresh instance with no ID yet: a new four-digit one, not a "re-roll".
        let d = claim(0xD0, None, &mut rng);
        assert!(!d.rerolled && d.id >= NEW_MIN);
        for o in [0xB0, 0xC0, 0xD0] {
            release(o);
        }
    }

    #[test]
    fn normalized_values_round_trip() {
        for id in [0, 1, 42, 4821, 9998, 9999] {
            assert_eq!(normalized_to_id(id_to_normalized(id)), id);
        }
        assert_eq!(normalized_to_id(2.0), 9999);
        assert_eq!(normalized_to_id(-1.0), 0);
    }
}
