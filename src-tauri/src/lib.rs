//! PULSE DJ Studio — Library Crate
//!
//! This module declares all submodules and provides the Tauri app builder.
//! All state is managed in-memory via `parking_lot::RwLock` wrapped in Tauri's
//! managed state system.

pub mod audio;
pub mod commands;
pub mod stems;
pub mod youtube;

use std::collections::HashMap;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

// ─── Core Application State ───────────────────────────────────────────────────

/// Top-level application state managed by Tauri.
/// Contains a map of deck IDs to their current state.
pub struct AppState {
    pub decks: RwLock<HashMap<String, DeckState>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            decks: RwLock::new(HashMap::new()),
        }
    }
}

// ─── Deck State ────────────────────────────────────────────────────────────────

/// The current processing status of a deck.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DeckStatus {
    /// Deck is empty, no track loaded.
    Empty,
    /// Track is being downloaded / extracted from YouTube.
    Downloading,
    /// Audio is being decoded into the RAM buffer.
    Decoding,
    /// Track is loaded and ready for playback.
    Ready,
    /// Stem separation is in progress.
    SeparatingStems,
    /// Stems are available.
    StemsReady,
    /// An error occurred.
    Error(String),
}

/// Identifies which stem to retrieve.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum StemType {
    Vocals,
    Drums,
    Bass,
    Other,
}

impl StemType {
    /// Parse a stem type from a string (case-insensitive).
    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "vocals" => Some(Self::Vocals),
            "drums" => Some(Self::Drums),
            "bass" => Some(Self::Bass),
            "other" => Some(Self::Other),
            _ => None,
        }
    }
}

/// Metadata about a loaded track.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMetadata {
    pub title: String,
    pub artist: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
    pub channels: u16,
    pub total_samples: usize,
}

/// Status snapshot for a deck, returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckStatusInfo {
    pub deck_id: String,
    pub status: DeckStatus,
    pub metadata: Option<TrackMetadata>,
    pub has_stems: bool,
    pub available_stems: Vec<StemType>,
}

/// A search result returned from YouTube search.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub duration_secs: f64,
    pub thumbnail_url: String,
    pub url: String,
    pub key: Option<String>,
    pub bpm: Option<f64>,
}

/// Complete state for a single deck.
pub struct DeckState {
    /// Current processing status.
    pub status: DeckStatus,
    /// Track metadata (available once decoded).
    pub metadata: Option<TrackMetadata>,
    /// Interleaved audio samples (f32, normalized to [-1, 1]).
    /// Stored as mono-mixed for the main buffer.
    pub audio_buffer: Option<audio::buffer::AudioBuffer>,
    /// Raw compressed audio bytes (M4A) for browser-native decoding.
    pub raw_audio_bytes: Option<Vec<u8>>,
    /// Separated stem buffers (raw WAV bytes), keyed by stem type.
    pub stem_buffers: HashMap<StemType, Vec<u8>>,
}

impl DeckState {
    /// Create a new empty deck state.
    pub fn new() -> Self {
        Self {
            status: DeckStatus::Empty,
            metadata: None,
            audio_buffer: None,
            raw_audio_bytes: None,
            stem_buffers: HashMap::new(),
        }
    }
}

// ─── Tauri App Builder ─────────────────────────────────────────────────────────

use tauri::{Emitter, Manager};
use stem_splitter_core::{set_download_progress_callback, set_split_progress_callback, SplitProgress};

#[tauri::command]
async fn close_splashscreen(window: tauri::Window) {
    // Close splashscreen
    if let Some(splashscreen) = window.get_webview_window("splashscreen") {
        splashscreen.close().unwrap();
    }
    // Show main window
    window.get_webview_window("main").unwrap().show().unwrap();
}

/// Build and run the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle_dl = app.handle().clone();
            let app_handle_sp = app.handle().clone();
            
            set_download_progress_callback(move |done, total| {
                let percent = if total > 0 { (done as f64 / total as f64) * 100.0 } else { 0.0 };
                let _ = app_handle_dl.emit("stem-download-progress", percent);
            });
            
            set_split_progress_callback(move |progress| {
                let payload = match progress {
                    SplitProgress::Stage(s) => serde_json::json!({ "type": "stage", "stage": s }),
                    SplitProgress::Chunks { done, total, percent } => serde_json::json!({ "type": "chunks", "done": done, "total": total, "percent": percent }),
                    SplitProgress::Writing { stem, done, total, percent } => serde_json::json!({ "type": "writing", "stem": stem, "done": done, "total": total, "percent": percent }),
                    SplitProgress::Finished => serde_json::json!({ "type": "finished" }),
                };
                let _ = app_handle_sp.emit("stem-split-progress", payload);
            });
            
            Ok(())
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::youtube::search_youtube,
            commands::audio::load_track,
            commands::audio::load_track_raw,
            commands::audio::extract_audio,
            commands::audio::get_audio_data,
            commands::audio::get_waveform_data,
            commands::audio::get_deck_status,
            commands::stems::separate_stems,
            commands::stems::get_stem_data,
            commands::stems::check_stem_model,
            commands::stems::download_stem_model,
            commands::playlist::get_youtube_playlist,
            commands::playlist::save_playlist,
            commands::playlist::load_playlist,
            commands::playlist::list_playlists,
            close_splashscreen,
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run PULSE application");
}
