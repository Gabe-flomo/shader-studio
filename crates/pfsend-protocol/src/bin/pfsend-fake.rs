//! pfsend-fake — pretend to be Playfield Send instances in Live, for the desktop app and tests.
//!
//!   cargo run --manifest-path crates/pfsend-protocol/Cargo.toml --bin pfsend-fake -- \
//!     --sends 4821:Drums,1234:Bass --rate 48000 --block 256 --seconds 60
//!
//! Options (all optional):
//!   --sends id:name,…       instances (default 4821:Drums)
//!   --rate HZ               Live's sample rate (default 48000)
//!   --block N               frames per process() call (default 256)
//!   --tone HZ               the first instance's tone; the next ones are 1.5× apart (default 220)
//!   --jitter MS             vary each block's timing by up to this
//!   --stall-every S --stall-ms MS    write nothing for MS every S seconds
//!   --rate-change-after S --rate-change-to HZ    Live changes its sample rate part-way
//!   --offline-from S --offline-to S  behave as Live's Export / Freeze between these times
//!   --crash-after S         stop like a crash: no bye, the segment left for the app to clean up
//!   --port N                where hellos go (default 11102)
//!   --seconds S             run this long, then say bye (default: until Ctrl-C)

use std::time::{Duration, Instant};

use pfsend_protocol::fake::{FakeInstance, FakeOptions};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let get = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let num = |k: &str, d: f64| get(k).and_then(|v| v.parse::<f64>().ok()).unwrap_or(d);
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{}", include_str!("pfsend-fake.rs").lines().skip(2).take_while(|l| l.starts_with("//!")).map(|l| l.trim_start_matches("//!")).collect::<Vec<_>>().join("\n"));
        return;
    }
    let sends = get("--sends").unwrap_or_else(|| "4821:Drums".into());
    let base = FakeOptions {
        sample_rate: num("--rate", 48_000.0),
        block: num("--block", 256.0).max(1.0) as usize,
        hello_port: num("--port", pfsend_protocol::HELLO_PORT as f64) as u16,
        jitter_ms: num("--jitter", 0.0),
        stall_every: num("--stall-every", 0.0),
        stall_ms: num("--stall-ms", 0.0),
        rate_change_after: num("--rate-change-after", 0.0),
        rate_change_to: num("--rate-change-to", 0.0),
        offline_from: num("--offline-from", 0.0),
        offline_to: num("--offline-to", 0.0),
        crash_after: num("--crash-after", 0.0),
        ..FakeOptions::default()
    };
    let tone = num("--tone", 220.0);
    let mut running = Vec::new();
    for (n, item) in sends.split(',').filter(|s| !s.is_empty()).enumerate() {
        let (id, name) = item.split_once(':').unwrap_or((item, ""));
        let id: u32 = id.trim().parse().unwrap_or(1000 + n as u32).min(pfsend_protocol::PAIRING_MAX);
        let o = FakeOptions { id, name: name.trim().into(), index: n as u32, tone_hz: tone * 1.5f64.powi(n as i32), ..base.clone() };
        match FakeInstance::start(o) {
            Ok(i) => {
                eprintln!("pfsend-fake: Send {id} {name} on {} → hellos to 127.0.0.1:{}", i.shm, base.hello_port);
                running.push(i);
            }
            Err(e) => eprintln!("pfsend-fake: couldn't start {id}: {e}"),
        }
    }
    if running.is_empty() {
        std::process::exit(1);
    }
    let seconds = num("--seconds", 0.0);
    let started = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(200));
        if seconds > 0.0 && started.elapsed().as_secs_f64() >= seconds {
            break;
        }
        if running.iter().all(|i| i.finished()) {
            eprintln!("pfsend-fake: every instance crashed on purpose; their segments are left behind");
            // Exit without running destructors' byes (they already "crashed").
            std::process::exit(0);
        }
    }
    for i in running {
        i.stop();
    }
}
