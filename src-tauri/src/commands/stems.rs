//! Stem separation Tauri commands.
//!
//! Handles initiating stem separation and retrieving separated stem data.

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, State};

use crate::{AppState, DeckStatus, StemType};
use stem_splitter_core::{split_file, SplitOptions, ensure_model, set_download_progress_callback};
use directories::ProjectDirs;
use serde::Serialize;
use tauri::Emitter;

/// Initiate stem separation for a loaded track.
#[tauri::command]
pub async fn separate_stems(
    app: AppHandle,
    deck_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Enable debug logging so we get clear feedback
    std::env::set_var("DEBUG_STEMS", "1");

    log::info!("Starting stem separation for deck {}", deck_id);

    // Get the raw audio bytes
    let raw_bytes = {
        let mut decks = state.decks.write();
        let deck = decks
            .get_mut(&deck_id)
            .ok_or_else(|| format!("Deck '{}' not found", deck_id))?;

        if deck.status == DeckStatus::StemsReady {
            return Ok("Stems already separated".to_string());
        }
        if deck.status == DeckStatus::SeparatingStems {
            return Ok("Stem separation already in progress".to_string());
        }

        let bytes = deck
            .raw_audio_bytes
            .as_ref()
            .ok_or_else(|| format!("No raw audio loaded in deck '{}'", deck_id))?
            .clone();

        deck.status = DeckStatus::SeparatingStems;
        bytes
    };

    let deck_id_clone = deck_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        // 1. Write the raw bytes to a temporary input file
        let temp_dir = std::env::temp_dir().join(format!("pulse_dj_stems_{}", deck_id_clone));
        let _ = fs::create_dir_all(&temp_dir);
        
        let input_path = temp_dir.join("input.m4a");
        fs::write(&input_path, &raw_bytes).map_err(|e| format!("Failed to write temp input: {}", e))?;

        // 2. Set up stem-splitter-core options
        let output_dir = temp_dir.join("output");
        let _ = fs::create_dir_all(&output_dir);
        
        let options = SplitOptions {
            output_dir: output_dir.to_string_lossy().to_string(),
            ..Default::default()
        };

        // 3. Run the AI separation
        log::info!("Running ONNX Demucs inference via stem-splitter-core...");
        let split_result = split_file(input_path.to_string_lossy().as_ref(), options)
            .map_err(|e| format!("Stem split failed: {}", e))?;

        log::info!("Inference complete.");

        // 4. Read the 4 resulting WAV files into memory
        let vocals = fs::read(&split_result.vocals_path).map_err(|e| format!("Failed to read vocals: {}", e))?;
        let drums = fs::read(&split_result.drums_path).map_err(|e| format!("Failed to read drums: {}", e))?;
        let bass = fs::read(&split_result.bass_path).map_err(|e| format!("Failed to read bass: {}", e))?;
        let other = fs::read(&split_result.other_path).map_err(|e| format!("Failed to read other: {}", e))?;

        // Clean up temp files
        let _ = fs::remove_dir_all(&temp_dir);

        Ok::<_, String>((vocals, drums, bass, other))
    })
    .await
    .map_err(|e| format!("Separation task panicked: {}", e))?;

    match result {
        Ok((vocals, drums, bass, other)) => {
            let mut decks = state.decks.write();
            if let Some(deck) = decks.get_mut(&deck_id) {
                deck.stem_buffers.insert(StemType::Vocals, vocals);
                deck.stem_buffers.insert(StemType::Drums, drums);
                deck.stem_buffers.insert(StemType::Bass, bass);
                deck.stem_buffers.insert(StemType::Other, other);
                deck.status = DeckStatus::StemsReady;
            }
            log::info!("Stem separation complete for deck {}", deck_id);
            Ok("Stem separation complete".to_string())
        }
        Err(e) => {
            let error_msg = format!("Stem separation failed: {}", e);
            let mut decks = state.decks.write();
            if let Some(deck) = decks.get_mut(&deck_id) {
                deck.status = DeckStatus::Error(error_msg.clone());
            }
            Err(error_msg)
        }
    }
}

/// Get the separated stem data (raw WAV bytes) for a specific stem type.
#[tauri::command]
pub async fn get_stem_data(
    deck_id: String,
    stem: String,
    state: State<'_, AppState>,
) -> Result<tauri::ipc::Response, String> {
    let stem_type = StemType::from_str_loose(&stem)
        .ok_or_else(|| format!("Unknown stem type '{}'", stem))?;

    let decks = state.decks.read();
    let deck = decks
        .get(&deck_id)
        .ok_or_else(|| format!("Deck '{}' not found", deck_id))?;

    let stem_data = deck
        .stem_buffers
        .get(&stem_type)
        .ok_or_else(|| format!("Stem '{:?}' not available for deck '{}'. Run separate_stems first.", stem_type, deck_id))?;

    Ok(tauri::ipc::Response::new(stem_data.clone()))
}

/// Checks if the stem separation model (htdemucs_ort_v1) is already downloaded.
#[tauri::command]
pub async fn check_stem_model() -> Result<bool, String> {
    let proj = ProjectDirs::from("dev", "StemSplitter", "stem-splitter-core")
        .ok_or_else(|| "Could not determine cache directory".to_string())?;
    
    let mut models_dir = PathBuf::from(proj.cache_dir());
    models_dir.push("models");

    if !models_dir.exists() {
        return Ok(false);
    }

    // Check if any file starts with "htdemucs_ort_v1"
    let entries = fs::read_dir(models_dir)
        .map_err(|e| format!("Failed to read models directory: {}", e))?;

    for entry in entries.flatten() {
        if let Ok(file_name) = entry.file_name().into_string() {
            if file_name.starts_with("htdemucs_ort_v1") {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

#[derive(Clone, Serialize)]
struct DownloadProgressPayload {
    downloaded: u64,
    total: u64,
}

/// Downloads the stem separation model.
#[tauri::command]
pub async fn download_stem_model(app: AppHandle) -> Result<(), String> {
    log::info!("Starting stem model download...");

    let result = tokio::task::spawn_blocking(|| {
        ensure_model("htdemucs_ort_v1", None)
    })
    .await
    .map_err(|e| format!("Download task panicked: {}", e))?;

    result.map_err(|e| format!("Failed to download model: {}", e))?;
    
    log::info!("Stem model downloaded successfully.");
    Ok(())
}

