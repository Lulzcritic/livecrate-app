//! YouTube-related Tauri commands.
//!
//! These commands are exposed to the frontend via `#[tauri::command]`.

use tauri::{AppHandle, State};

use crate::{AppState, TrackResult};

/// Search YouTube for tracks matching the given query.
///
/// Returns up to 10 search results with metadata.
#[tauri::command]
pub async fn search_youtube(
    query: String,
    app: AppHandle,
    _state: State<'_, AppState>,
) -> Result<Vec<TrackResult>, String> {
    log::info!("Searching YouTube for: {}", query);

    let results = crate::youtube::extractor::search(&query, 10, &app)
        .await
        .map_err(|e| format!("YouTube search failed: {}", e))?;

    log::info!("Found {} results for '{}'", results.len(), query);

    Ok(results)
}
