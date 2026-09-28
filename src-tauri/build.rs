fn main() {
  // The Audio engine's native half (AVAudioEngine, Audio Units): macOS only (src/audio_engine/ffi.rs).
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
    println!("cargo:rerun-if-changed=native/audio_engine.m");
    cc::Build::new()
      .file("native/audio_engine.m")
      .flag("-fobjc-arc")
      .flag("-fmodules")
      .compile("playfield_audio_engine");
    for fw in ["AVFAudio", "AudioToolbox", "CoreAudio", "CoreAudioKit", "AudioUnit", "AppKit", "Foundation"] {
      println!("cargo:rustc-link-lib=framework={fw}");
    }
  }
  tauri_build::build()
}
