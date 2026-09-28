// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // A plug-in trial load (audio_engine/safety.rs): no window, no Tauri; just the trial and its exit code.
  if let Some(code) = app_lib::probe_from_args() {
    std::process::exit(code);
  }
  app_lib::run();
}
