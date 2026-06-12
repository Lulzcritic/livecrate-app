//! YouTube extraction via yt-dlp subprocess.
//!
//! Uses `tokio::process::Command` to invoke the yt-dlp binary for:
//! - Searching YouTube for tracks matching a query
//! - Extracting audio stream URLs for direct download
//! - Downloading raw audio bytes to RAM (never to disk)

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::TrackResult;

/// Errors specific to YouTube extraction.
#[derive(Debug, thiserror::Error)]
pub enum YtDlpError {
    #[error("yt-dlp binary not found. Ensure yt-dlp is installed and on PATH.")]
    BinaryNotFound,

    #[error("yt-dlp returned an error: {0}")]
    ProcessError(String),

    #[error("Failed to parse yt-dlp JSON output: {0}")]
    ParseError(String),

    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("No audio URL found in yt-dlp output")]
    NoAudioUrl,
}

/// Raw JSON structure returned by `yt-dlp --dump-json` for search results.
#[derive(Debug, Deserialize)]
struct YtDlpSearchEntry {
    id: Option<String>,
    title: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    thumbnails: Option<Vec<YtDlpThumbnail>>,
    webpage_url: Option<String>,
    url: Option<String>,
    original_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YtDlpThumbnail {
    url: Option<String>,
}

/// Detailed info from `yt-dlp --dump-json` for a single video.
#[derive(Debug, Deserialize)]
struct YtDlpVideoInfo {
    id: Option<String>,
    title: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    url: Option<String>,
    webpage_url: Option<String>,
    requested_downloads: Option<Vec<YtDlpDownload>>,
}

#[derive(Debug, Deserialize)]
struct YtDlpDownload {
    url: Option<String>,
}

/// Search YouTube for tracks matching the given query.
///
/// Returns up to `max_results` entries. Uses `ytsearch{N}:query` syntax.
pub async fn search(query: &str, max_results: usize, app: &AppHandle) -> Result<Vec<TrackResult>, YtDlpError> {
    let search_query = format!("ytsearch{}:{}", max_results, query);

    let output = app.shell()
        .sidecar("yt-dlp")
        .map_err(|_| YtDlpError::BinaryNotFound)?
        .args([
            "--dump-json",
            "--flat-playlist",
            "--no-warnings",
            "--default-search",
            "ytsearch",
            &search_query,
        ])
        .output()
        .await
        .map_err(|e| YtDlpError::ProcessError(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(YtDlpError::ProcessError(stderr.to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    // yt-dlp outputs one JSON object per line (NDJSON)
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<YtDlpSearchEntry>(line) {
            Ok(entry) => {
                let id = entry.id.unwrap_or_default();
                let thumbnail = entry
                    .thumbnail
                    .or_else(|| {
                        entry
                            .thumbnails
                            .and_then(|t| t.first().and_then(|t| t.url.clone()))
                    })
                    .unwrap_or_default();

                let url = entry
                    .webpage_url
                    .or(entry.url)
                    .or(entry.original_url)
                    .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={}", id));

                results.push(TrackResult {
                    id: id.clone(),
                    title: entry.title.unwrap_or_else(|| "Unknown Title".into()),
                    artist: entry
                        .uploader
                        .or(entry.channel)
                        .unwrap_or_else(|| "Unknown Artist".into()),
                    duration_secs: entry.duration.unwrap_or(0.0),
                    thumbnail_url: thumbnail,
                    url,
                    key: None,
                    bpm: None,
                });
            }
            Err(e) => {
                log::warn!("Failed to parse yt-dlp search entry: {}", e);
                continue;
            }
        }
    }

    Ok(results)
}

/// Extract the best audio stream URL for a given YouTube video URL.
///
/// Returns the direct stream URL and metadata about the track.
pub async fn extract_audio_info(
    video_url: &str,
    app: &AppHandle,
) -> Result<(String, TrackResult), YtDlpError> {
    let output = app.shell()
        .sidecar("yt-dlp")
        .map_err(|_| YtDlpError::BinaryNotFound)?
        .args([
            "--dump-json",
            "--no-warnings",
            "-f",
            "bestaudio[ext=m4a]/bestaudio",
            video_url,
        ])
        .output()
        .await
        .map_err(|e| YtDlpError::ProcessError(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(YtDlpError::ProcessError(stderr.to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let info: YtDlpVideoInfo = serde_json::from_str(&stdout)
        .map_err(|e| YtDlpError::ParseError(e.to_string()))?;

    // The direct stream URL is in `url` field when using -f bestaudio
    let audio_url = info
        .url
        .or_else(|| {
            info.requested_downloads
                .and_then(|d| d.into_iter().next())
                .and_then(|d| d.url)
        })
        .ok_or(YtDlpError::NoAudioUrl)?;

    let id = info.id.unwrap_or_default();
    let track = TrackResult {
        id: id.clone(),
        title: info.title.unwrap_or_else(|| "Unknown Title".into()),
        artist: info
            .uploader
            .or(info.channel)
            .unwrap_or_else(|| "Unknown Artist".into()),
        duration_secs: info.duration.unwrap_or(0.0),
        thumbnail_url: info.thumbnail.unwrap_or_default(),
        url: info
            .webpage_url
            .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={}", id)),
        key: None,
        bpm: None,
    };

    Ok((audio_url, track))
}

/// Download audio bytes from a YouTube URL into memory.
///
/// Downloads to a temp file first to ensure the MP4/M4A container is properly
/// finalized (the moov atom requires seeking, which doesn't work with stdout piping).
/// Then reads the file bytes into memory and cleans up.
pub async fn download_audio_bytes(video_url: &str, app: &AppHandle) -> Result<Vec<u8>, YtDlpError> {
    let tmp_dir = std::env::temp_dir().join("pulse_dj");
    tokio::fs::create_dir_all(&tmp_dir).await?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_micros();
    let tmp_file = tmp_dir.join(format!("track_{}_{}.m4a", std::process::id(), timestamp));
    let tmp_path = tmp_file.to_string_lossy().to_string();

    log::info!("Downloading audio to temp file: {}", tmp_path);

    let output = app.shell()
        .sidecar("yt-dlp")
        .map_err(|_| YtDlpError::BinaryNotFound)?
        .args([
            "-f",
            "bestaudio[ext=m4a]/bestaudio",
            "--no-warnings",
            "-o",
            &tmp_path,
            "--force-overwrites",
            video_url,
        ])
        .output()
        .await
        .map_err(|e| YtDlpError::ProcessError(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Clean up on error
        let _ = tokio::fs::remove_file(&tmp_file).await;
        return Err(YtDlpError::ProcessError(stderr.to_string()));
    }

    // Read the properly-formed M4A file
    let bytes = tokio::fs::read(&tmp_file).await.map_err(|e| {
        YtDlpError::ProcessError(format!("Failed to read temp file: {}", e))
    })?;

    // Clean up
    let _ = tokio::fs::remove_file(&tmp_file).await;

    if bytes.is_empty() {
        return Err(YtDlpError::ProcessError(
            "yt-dlp produced an empty audio file".into(),
        ));
    }

    log::info!(
        "Downloaded {} bytes of audio from {}",
        bytes.len(),
        video_url
    );

    Ok(bytes)
}
