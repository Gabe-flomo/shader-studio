//! The POSIX shared-memory mapping of one segment (macOS and Linux; Windows later uses
//! CreateFileMappingW with the same layout).

use std::ffi::CString;
use std::io;
use std::sync::atomic::Ordering;

use crate::{segment_bytes, valid_shm_name, Header, CHANNELS, HEADER_BYTES, MAGIC, PROTOCOL_VERSION};

/// A mapped segment. The plugin [`Segment::create`]s it (and unlinks it when dropped);
/// the app [`Segment::open`]s it (and only unmaps).
pub struct Segment {
    ptr: *mut u8,
    len: usize,
    name: String,
    owner: bool,
}

// The mapping is plain shared memory; every shared field is atomic or written by one side only.
unsafe impl Send for Segment {}
unsafe impl Sync for Segment {}

fn cname(name: &str) -> io::Result<CString> {
    CString::new(name).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "bad shm name"))
}

impl Segment {
    /// Create (or replace a stale one of the same name) and fill in the header. Not for the audio thread.
    pub fn create(name: &str, sample_rate: f64, capacity_frames: u32, pid: u32, pairing_id: u32) -> io::Result<Self> {
        if !valid_shm_name(name) || !capacity_frames.is_power_of_two() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad segment name or size"));
        }
        let c = cname(name)?;
        let len = segment_bytes(capacity_frames);
        unsafe {
            let mut fd = libc::shm_open(c.as_ptr(), libc::O_CREAT | libc::O_EXCL | libc::O_RDWR, 0o600 as libc::c_uint);
            if fd < 0 && io::Error::last_os_error().raw_os_error() == Some(libc::EEXIST) {
                // Left over from a crashed process with a reused pid.
                libc::shm_unlink(c.as_ptr());
                fd = libc::shm_open(c.as_ptr(), libc::O_CREAT | libc::O_EXCL | libc::O_RDWR, 0o600 as libc::c_uint);
            }
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            if libc::ftruncate(fd, len as libc::off_t) != 0 {
                let e = io::Error::last_os_error();
                libc::close(fd);
                libc::shm_unlink(c.as_ptr());
                return Err(e);
            }
            let ptr = libc::mmap(std::ptr::null_mut(), len, libc::PROT_READ | libc::PROT_WRITE, libc::MAP_SHARED, fd, 0);
            libc::close(fd);
            if ptr == libc::MAP_FAILED {
                let e = io::Error::last_os_error();
                libc::shm_unlink(c.as_ptr());
                return Err(e);
            }
            // A fresh object reads as zeros; the header's plain fields are written before anyone can find it.
            let h = &mut *(ptr as *mut Header);
            h.magic = MAGIC;
            h.version = PROTOCOL_VERSION;
            h.header_bytes = HEADER_BYTES as u32;
            h.capacity_frames = capacity_frames;
            h.channels = CHANNELS as u32;
            h.pid = pid;
            h.sample_rate.store(sample_rate.to_bits(), Ordering::Release);
            h.pairing_id.store(pairing_id, Ordering::Release);
            Ok(Segment { ptr: ptr as *mut u8, len, name: name.to_string(), owner: true })
        }
    }

    /// Map an existing segment read-write (the app writes only the app area), checking its header.
    pub fn open(name: &str) -> io::Result<Self> {
        if !valid_shm_name(name) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a Playfield Send segment"));
        }
        let c = cname(name)?;
        unsafe {
            let fd = libc::shm_open(c.as_ptr(), libc::O_RDWR, 0);
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            let mut st: libc::stat = std::mem::zeroed();
            if libc::fstat(fd, &mut st) != 0 {
                let e = io::Error::last_os_error();
                libc::close(fd);
                return Err(e);
            }
            let len = st.st_size as usize;
            if len < HEADER_BYTES {
                libc::close(fd);
                return Err(io::Error::new(io::ErrorKind::InvalidData, "segment too small"));
            }
            let ptr = libc::mmap(std::ptr::null_mut(), len, libc::PROT_READ | libc::PROT_WRITE, libc::MAP_SHARED, fd, 0);
            libc::close(fd);
            if ptr == libc::MAP_FAILED {
                return Err(io::Error::last_os_error());
            }
            let seg = Segment { ptr: ptr as *mut u8, len, name: name.to_string(), owner: false };
            let h = seg.header();
            let ok = h.magic == MAGIC
                && (h.version == PROTOCOL_VERSION || h.version + 1 == PROTOCOL_VERSION)
                && h.channels as usize == CHANNELS
                && h.capacity_frames.is_power_of_two()
                && segment_bytes(h.capacity_frames) <= len;
            if !ok {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "not a Playfield Send segment (or a newer protocol)"));
            }
            Ok(seg)
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn header(&self) -> &Header {
        unsafe { &*(self.ptr as *const Header) }
    }

    /// The ring: `capacity_frames * 2` floats after the header.
    pub fn ring(&self) -> *mut f32 {
        unsafe { self.ptr.add(HEADER_BYTES) as *mut f32 }
    }

    /// The audio thread's copy (see [`crate::write_planar`]).
    #[inline]
    pub fn write(&self, left: &[f32], right: &[f32], frames: usize) {
        unsafe { crate::write_planar(self.header(), self.ring(), left, right, frames) }
    }

    /// Keep the mapping but don't unlink the name on drop (a test of a crashed plugin, or a hand-over).
    pub fn leak_name(&mut self) {
        self.owner = false;
    }
}

impl Drop for Segment {
    fn drop(&mut self) {
        unsafe {
            libc::munmap(self.ptr as *mut libc::c_void, self.len);
            if self.owner {
                if let Ok(c) = cname(&self.name) {
                    libc::shm_unlink(c.as_ptr());
                }
            }
        }
    }
}

/// Remove a segment's name (the app does this for a plugin whose process is gone).
pub fn unlink(name: &str) -> bool {
    if !valid_shm_name(name) {
        return false;
    }
    match cname(name) {
        Ok(c) => unsafe { libc::shm_unlink(c.as_ptr()) == 0 },
        Err(_) => false,
    }
}

/// Is a process still there? (`kill(pid, 0)`: EPERM means it exists but isn't ours.)
pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    unsafe {
        if libc::kill(pid as libc::pid_t, 0) == 0 {
            return true;
        }
        io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{capacity_for, shm_name, RingReader};

    fn unique(n: u32) -> String {
        // Our own pid plus a number no other test uses.
        shm_name(std::process::id(), 9000 + n)
    }

    #[test]
    fn create_open_write_read_and_unlink() {
        let name = unique(1);
        let cap = capacity_for(48_000.0);
        let w = Segment::create(&name, 48_000.0, cap, std::process::id(), 4821).expect("create");
        let r = Segment::open(&name).expect("open");
        assert_eq!(r.header().pairing_id.load(Ordering::Relaxed), 4821);
        assert_eq!(r.header().sample_rate(), 48_000.0);
        let mut reader = RingReader::new();
        let mut out = Vec::new();
        unsafe { reader.read(r.header(), r.ring(), &mut out, usize::MAX) };
        let l: Vec<f32> = (0..128).map(|i| i as f32 * 0.01).collect();
        let rr: Vec<f32> = l.iter().map(|x| -x).collect();
        w.write(&l, &rr, 128);
        assert_eq!(unsafe { reader.read(r.header(), r.ring(), &mut out, usize::MAX) }.frames, 128);
        assert_eq!(out[2], 0.01);
        assert_eq!(out[3], -0.01);
        // The app area written by the reader is seen by the writer.
        r.header().app.label.write("Drums");
        assert_eq!(w.header().app.label.read().as_deref(), Some("Drums"));
        drop(r);
        drop(w);
        // The owner unlinked it.
        assert!(Segment::open(&name).is_err());
    }

    #[test]
    fn a_stale_segment_of_the_same_name_is_replaced() {
        let name = unique(2);
        let mut first = Segment::create(&name, 44_100.0, 1 << 15, 1, 1).unwrap();
        first.leak_name();
        drop(first);
        let again = Segment::create(&name, 48_000.0, 1 << 16, 2, 2).expect("replaces the stale one");
        assert_eq!(Segment::open(&name).unwrap().header().capacity_frames, 1 << 16);
        drop(again);
    }

    #[test]
    fn refuses_other_names_and_garbage() {
        assert!(Segment::open("/somebody-else").is_err());
        assert!(!unlink("/somebody-else"));
        assert!(Segment::open(&unique(3)).is_err(), "missing");
    }

    #[test]
    fn pid_alive_knows_this_process() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(0));
        assert!(!pid_alive(999_999_999));
    }
}
