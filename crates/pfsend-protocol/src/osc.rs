//! The hello and bye messages, as OSC 1.0 (the same wire format the Live connector speaks, so
//! `src/lib/osc/decode.js` and the browser bridge can read them too).
//!
//! `/pfsend/hello  ,isssfiiii  id name shm version sample_rate channels pid generation flags`
//! `/pfsend/bye    ,s          shm`

/// One instance announcing itself.
#[derive(Debug, Clone, PartialEq)]
pub struct Hello {
    pub id: u32,
    pub name: String,
    pub shm: String,
    pub sample_rate: f32,
    pub channels: u32,
    pub pid: u32,
    pub version: String,
    pub generation: u32,
    pub flags: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    Hello(Hello),
    Bye { shm: String },
}

fn pad(buf: &mut Vec<u8>) {
    while buf.len() % 4 != 0 {
        buf.push(0);
    }
}

fn put_str(buf: &mut Vec<u8>, s: &str) {
    buf.extend_from_slice(s.as_bytes());
    buf.push(0);
    pad(buf);
}

/// Encode into `buf` (cleared first), so the announce thread reuses one buffer.
pub fn encode_hello(h: &Hello, buf: &mut Vec<u8>) {
    buf.clear();
    put_str(buf, "/pfsend/hello");
    put_str(buf, ",isssfiiii");
    buf.extend_from_slice(&(h.id as i32).to_be_bytes());
    put_str(buf, &h.name);
    put_str(buf, &h.shm);
    put_str(buf, &h.version);
    buf.extend_from_slice(&h.sample_rate.to_be_bytes());
    buf.extend_from_slice(&(h.channels as i32).to_be_bytes());
    buf.extend_from_slice(&(h.pid as i32).to_be_bytes());
    buf.extend_from_slice(&(h.generation as i32).to_be_bytes());
    buf.extend_from_slice(&(h.flags as i32).to_be_bytes());
}

pub fn encode_bye(shm: &str, buf: &mut Vec<u8>) {
    buf.clear();
    put_str(buf, "/pfsend/bye");
    put_str(buf, ",s");
    put_str(buf, shm);
}

enum Arg {
    I(i32),
    F(f32),
    D(f64),
    S(String),
}

fn read_str(b: &[u8], at: &mut usize) -> Option<String> {
    let rest = b.get(*at..)?;
    let end = rest.iter().position(|&c| c == 0)?;
    let s = std::str::from_utf8(&rest[..end]).ok()?.to_string();
    *at += (end + 4) & !3;
    Some(s)
}

fn read4(b: &[u8], at: &mut usize) -> Option<[u8; 4]> {
    let v = b.get(*at..*at + 4)?;
    *at += 4;
    Some([v[0], v[1], v[2], v[3]])
}

fn parse(b: &[u8]) -> Option<(String, Vec<Arg>)> {
    let mut at = 0;
    let address = read_str(b, &mut at)?;
    let tags = read_str(b, &mut at)?;
    let tags = tags.strip_prefix(',')?;
    let mut args = Vec::with_capacity(tags.len());
    for t in tags.chars() {
        args.push(match t {
            'i' => Arg::I(i32::from_be_bytes(read4(b, &mut at)?)),
            'f' => Arg::F(f32::from_be_bytes(read4(b, &mut at)?)),
            'd' => {
                let hi = read4(b, &mut at)?;
                let lo = read4(b, &mut at)?;
                Arg::D(f64::from_be_bytes([hi[0], hi[1], hi[2], hi[3], lo[0], lo[1], lo[2], lo[3]]))
            }
            's' => Arg::S(read_str(b, &mut at)?),
            _ => return None,
        });
    }
    Some((address, args))
}

/// Read one datagram (None for anything that isn't ours or is malformed).
pub fn decode_message(b: &[u8]) -> Option<Message> {
    let (address, args) = parse(b)?;
    let int = |i: usize| match args.get(i) {
        Some(Arg::I(v)) => Some(*v),
        _ => None,
    };
    let float = |i: usize| match args.get(i) {
        Some(Arg::F(v)) => Some(*v),
        Some(Arg::D(v)) => Some(*v as f32),
        Some(Arg::I(v)) => Some(*v as f32),
        _ => None,
    };
    let string = |i: usize| match args.get(i) {
        Some(Arg::S(v)) => Some(v.clone()),
        _ => None,
    };
    match address.as_str() {
        "/pfsend/hello" => Some(Message::Hello(Hello {
            id: int(0)?.clamp(0, crate::PAIRING_MAX as i32) as u32,
            name: string(1)?,
            shm: string(2)?,
            version: string(3)?,
            sample_rate: float(4)?,
            channels: int(5)?.max(0) as u32,
            pid: int(6)?.max(0) as u32,
            generation: int(7).unwrap_or(0) as u32,
            flags: int(8).unwrap_or(0) as u32,
        })),
        "/pfsend/bye" => Some(Message::Bye { shm: string(0)? }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello() -> Hello {
        Hello {
            id: 4821,
            name: "Drums é".into(),
            shm: "/pfsend.123.0".into(),
            sample_rate: 48_000.0,
            channels: 2,
            pid: 123,
            version: "1.0.0".into(),
            generation: 3,
            flags: 1,
        }
    }

    #[test]
    fn hello_and_bye_round_trip() {
        let mut buf = Vec::new();
        encode_hello(&hello(), &mut buf);
        assert_eq!(buf.len() % 4, 0);
        assert_eq!(decode_message(&buf), Some(Message::Hello(hello())));
        encode_bye("/pfsend.123.0", &mut buf);
        assert_eq!(decode_message(&buf), Some(Message::Bye { shm: "/pfsend.123.0".into() }));
    }

    #[test]
    fn an_empty_name_and_other_messages() {
        let mut h = hello();
        h.name.clear();
        let mut buf = Vec::new();
        encode_hello(&h, &mut buf);
        assert_eq!(decode_message(&buf), Some(Message::Hello(h)));
        // The Live connector's own messages, truncated packets and garbage are ignored.
        let mut other = Vec::new();
        put_str(&mut other, "/pf/hello");
        put_str(&mut other, ",");
        assert_eq!(decode_message(&other), None);
        assert_eq!(decode_message(&buf[..buf.len() - 6]), None);
        assert_eq!(decode_message(b"garbage"), None);
        assert_eq!(decode_message(&[]), None);
    }
}
