// PULSE DJ Studio — Tauri v2 Application Entry Point
// This binary crate simply delegates to the library crate.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pulse_lib::run();
}
