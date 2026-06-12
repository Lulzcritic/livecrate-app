//! Audio-related Tauri commands.
//!
//! Handles track loading (download + decode), audio data retrieval,
//! waveform generation, and deck status queries.

use tauri::{AppHandle, State};

use crate::{
    audio::{buffer::AudioBuffer, decoder},
    AppState, DeckState, DeckStatus, DeckStatusInfo, StemType, TrackMetadata,
};

/// Load a track from a YouTube URL into a deck.
///
/// This command:
/// 1. Extracts audio info and downloads bytes via yt-dlp
/// 2. Decodes the audio into f32 samples via symphonia
/// 3. Stores the decoded audio in the deck's RAM buffer
/// 4. Returns track metadata to the frontend
#[tauri::command]
pub async fn load_track(
    url: String,
    deck_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TrackMetadata, String> {
    log::info!("Loading track into deck {}: {}", deck_id, url);

    // Initialize deck state as downloading
    {
        let mut decks = state.decks.write();
        let deck = decks.entry(deck_id.clone()).or_insert_with(DeckState::new);
        deck.status = DeckStatus::Downloading;
        deck.audio_buffer = None;
        deck.stem_buffers.clear();
        deck.metadata = None;
    }

    // Step 1: Extract audio info and get the direct URL + metadata
    let (_audio_url, track_info) = crate::youtube::extractor::extract_audio_info(&url, &app)
        .await
        .map_err(|e| {
            set_deck_error(&state, &deck_id, &e.to_string());
            format!("Failed to extract audio info: {}", e)
        })?;

    log::info!(
        "Extracted audio URL for '{}' by {}",
        track_info.title,
        track_info.artist
    );

    // Step 2: Download audio bytes to RAM
    // We pass the original YouTube URL instead of the direct stream URL.
    // yt-dlp handles YouTube URLs natively, whereas passing a generic raw stream URL
    // back to yt-dlp might cause the generic extractor to hang or fail.
    let audio_bytes = crate::youtube::extractor::download_audio_bytes(&url, &app)
        .await
        .map_err(|e| {
            set_deck_error(&state, &deck_id, &e.to_string());
            format!("Failed to download audio: {}", e)
        })?;

    log::info!("Downloaded {} bytes, starting decode", audio_bytes.len());

    // Save raw bytes for browser-native decoding
    let raw_bytes_for_storage = audio_bytes.clone();

    // Update status to decoding
    {
        let mut decks = state.decks.write();
        if let Some(deck) = decks.get_mut(&deck_id) {
            deck.status = DeckStatus::Decoding;
            deck.raw_audio_bytes = Some(raw_bytes_for_storage);
        }
    }

    // Step 3: Decode audio bytes into f32 samples
    // Run in a blocking task since symphonia is CPU-intensive
    let decoded = tokio::task::spawn_blocking(move || {
        decoder::decode_audio_bytes(&audio_bytes, None)
    })
    .await
    .map_err(|e| {
        set_deck_error(&state, &deck_id, &e.to_string());
        format!("Decode task panicked: {}", e)
    })?
    .map_err(|e| {
        set_deck_error(&state, &deck_id, &e.to_string());
        format!("Audio decode failed: {}", e)
    })?;

    log::info!(
        "Decoded: {} frames, {}Hz, {} channels",
        decoded.total_frames,
        decoded.sample_rate,
        decoded.channels
    );

    // Step 4: Create audio buffer and metadata
    let buffer = AudioBuffer::new(
        decoded.samples,
        decoded.sample_rate,
        decoded.channels,
    );

    let metadata = TrackMetadata {
        title: track_info.title,
        artist: track_info.artist,
        duration_secs: buffer.duration_secs(),
        sample_rate: buffer.sample_rate,
        channels: buffer.channels,
        total_samples: buffer.total_frames,
    };

    // Step 5: Store in deck state
    {
        let mut decks = state.decks.write();
        if let Some(deck) = decks.get_mut(&deck_id) {
            deck.metadata = Some(metadata.clone());
            deck.audio_buffer = Some(buffer);
            deck.status = DeckStatus::Ready;
        }
    }

    log::info!(
        "Track loaded into deck {}: {} ({:.1}s)",
        deck_id,
        metadata.title,
        metadata.duration_secs
    );

    Ok(metadata)
}

/// Get a chunk of raw audio data from a deck.
///
/// Returns interleaved f32 samples starting at `start` frame for `length` frames.
/// Used for audio playback in the frontend via Web Audio API.
#[tauri::command]
pub async fn get_audio_data(
    deck_id: String,
    start: usize,
    length: usize,
    state: State<'_, AppState>,
) -> Result<tauri::ipc::Response, String> {
    let decks = state.decks.read();
    let deck = decks
        .get(&deck_id)
        .ok_or_else(|| format!("Deck '{}' not found", deck_id))?;

    let buffer = deck
        .audio_buffer
        .as_ref()
        .ok_or_else(|| format!("No audio loaded in deck '{}'", deck_id))?;

    let data = buffer.get_mono_range(start, length);
    // Convert f32 array directly to u8 array for raw binary IPC
    let bytes = unsafe { std::slice::from_raw_parts(data.as_ptr() as *const u8, data.len() * 4) };
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

/// Get downsampled waveform data for display.
///
/// Returns `num_points` peak amplitude values representing the full track.
#[tauri::command]
pub async fn get_waveform_data(
    deck_id: String,
    num_points: usize,
    state: State<'_, AppState>,
) -> Result<Vec<f32>, String> {
    let decks = state.decks.read();
    let deck = decks
        .get(&deck_id)
        .ok_or_else(|| format!("Deck '{}' not found", deck_id))?;

    let buffer = deck
        .audio_buffer
        .as_ref()
        .ok_or_else(|| format!("No audio loaded in deck '{}'", deck_id))?;

    Ok(buffer.generate_waveform(num_points))
}

/// Get the current status of a deck.
#[tauri::command]
pub async fn get_deck_status(
    deck_id: String,
    state: State<'_, AppState>,
) -> Result<DeckStatusInfo, String> {
    let decks = state.decks.read();

    let (status, metadata, has_stems, available_stems) =
        if let Some(deck) = decks.get(&deck_id) {
            let stems: Vec<StemType> = deck.stem_buffers.keys().copied().collect();
            (
                deck.status.clone(),
                deck.metadata.clone(),
                !deck.stem_buffers.is_empty(),
                stems,
            )
        } else {
            (DeckStatus::Empty, None, false, vec![])
        };

    Ok(DeckStatusInfo {
        deck_id,
        status,
        metadata,
        has_stems,
        available_stems,
    })
}

/// Helper to set a deck into an error state.
fn set_deck_error(state: &State<'_, AppState>, deck_id: &str, error: &str) {
    let mut decks = state.decks.write();
    if let Some(deck) = decks.get_mut(deck_id) {
        deck.status = DeckStatus::Error(error.to_string());
    }
}

/// Return the raw compressed audio bytes (M4A) stored during load_track.
/// These bytes are the original file downloaded from YouTube, properly containerized.
/// The browser's native C++ decoder (decodeAudioData) handles playback.
#[tauri::command]
pub async fn load_track_raw(
    deck_id: String,
    state: State<'_, AppState>,
) -> Result<tauri::ipc::Response, String> {
    let decks = state.decks.read();
    let deck = decks
        .get(&deck_id)
        .ok_or_else(|| format!("Deck '{}' not found", deck_id))?;

    let raw_bytes = deck
        .raw_audio_bytes
        .as_ref()
        .ok_or_else(|| format!("No raw audio data in deck '{}'", deck_id))?;

    log::info!("Returning {} raw bytes for deck {}", raw_bytes.len(), deck_id);
    Ok(tauri::ipc::Response::new(raw_bytes.clone()))
}

/// Download raw audio bytes from a URL without loading into a deck.
/// Used for background analysis.
#[tauri::command]
pub async fn extract_audio(url: String, app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    log::info!("Extracting raw audio for background analysis: {}", url);
    let audio_bytes = crate::youtube::extractor::download_audio_bytes(&url, &app)
        .await
        .map_err(|e| format!("Failed to download audio for analysis: {}", e))?;
    
    Ok(tauri::ipc::Response::new(audio_bytes))
}
