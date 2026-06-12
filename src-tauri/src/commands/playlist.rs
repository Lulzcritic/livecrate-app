use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use serde_json::Value;
use std::fs;

use crate::TrackResult;

fn get_playlists_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir().map_err(|e| format!("Failed to get app data dir: {}", e))?;
    path.push("playlists");
    
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| format!("Failed to create playlists dir: {}", e))?;
    }
    
    Ok(path)
}

#[tauri::command]
pub async fn get_youtube_playlist(url: String) -> Result<Vec<TrackResult>, String> {
    log::info!("Fetching YouTube playlist: {}", url);
    
    let output = Command::new("yt-dlp")
        .args(&[
            "--flat-playlist",
            "--dump-json",
            &url
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp error: {}", err_msg));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut tracks = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(v) = serde_json::from_str::<Value>(line) {
            let id = v.get("id").and_then(|id| id.as_str()).unwrap_or("").to_string();
            let mut title = v.get("title").and_then(|t| t.as_str()).unwrap_or("Unknown").to_string();
            let mut artist = v.get("uploader").or_else(|| v.get("channel")).and_then(|a| a.as_str()).unwrap_or("Unknown").to_string();
            
            if artist == "Unknown" && title.contains(" - ") {
                let parts: Vec<&str> = title.splitn(2, " - ").collect();
                if parts.len() == 2 {
                    artist = parts[0].trim().to_string();
                    title = parts[1].trim().to_string();
                }
            }
            let duration_secs = v.get("duration").and_then(|d| d.as_f64()).unwrap_or(0.0);
            
            // Extract best thumbnail
            let mut thumbnail_url = String::new();
            if let Some(thumbnails) = v.get("thumbnails").and_then(|t| t.as_array()) {
                if let Some(last) = thumbnails.last() {
                    thumbnail_url = last.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string();
                }
            }

            let track_url = v.get("url").and_then(|u| u.as_str()).unwrap_or(&format!("https://www.youtube.com/watch?v={}", id)).to_string();

            if !id.is_empty() {
                tracks.push(TrackResult {
                    id,
                    title,
                    artist,
                    duration_secs,
                    thumbnail_url,
                    url: track_url,
                    key: None,
                    bpm: None,
                });
            }
        }
    }

    log::info!("Found {} tracks in playlist", tracks.len());
    Ok(tracks)
}

#[tauri::command]
pub async fn save_playlist(app: AppHandle, name: String, tracks: Vec<TrackResult>) -> Result<(), String> {
    let mut path = get_playlists_dir(&app)?;
    
    // Sanitize filename
    let safe_name = name.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-', "_");
    path.push(format!("{}.json", safe_name));
    
    let json = serde_json::to_string_pretty(&tracks).map_err(|e| format!("Failed to serialize playlist: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write playlist file: {}", e))?;
    
    log::info!("Saved playlist '{}' to {:?}", name, path);
    Ok(())
}

#[tauri::command]
pub async fn load_playlist(app: AppHandle, name: String) -> Result<Vec<TrackResult>, String> {
    let mut path = get_playlists_dir(&app)?;
    path.push(format!("{}.json", name));
    
    if !path.exists() {
        return Err(format!("Playlist file not found: {:?}", path));
    }
    
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read playlist file: {}", e))?;
    let tracks: Vec<TrackResult> = serde_json::from_str(&content).map_err(|e| format!("Failed to parse playlist: {}", e))?;
    
    log::info!("Loaded playlist '{}' with {} tracks", name, tracks.len());
    Ok(tracks)
}

#[tauri::command]
pub async fn list_playlists(app: AppHandle) -> Result<Vec<String>, String> {
    let path = get_playlists_dir(&app)?;
    let mut playlists = Vec::new();
    
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Some(ext) = entry.path().extension() {
                if ext == "json" {
                    if let Some(file_stem) = entry.path().file_stem() {
                        playlists.push(file_stem.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    
    Ok(playlists)
}
