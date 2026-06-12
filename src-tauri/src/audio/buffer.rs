//! RAM audio buffer manager.
//!
//! All audio data lives in memory — this module provides the `AudioBuffer`
//! type that stores decoded samples and provides efficient access for
//! playback, waveform generation, and stem processing.

use serde::{Deserialize, Serialize};

/// An in-memory audio buffer storing decoded f32 samples.
///
/// Stores both the original interleaved multi-channel data and a pre-computed
/// mono mix for waveform display and stem separation.
#[derive(Debug, Clone)]
pub struct AudioBuffer {
    /// Interleaved multi-channel samples (f32, [-1.0, 1.0]).
    pub interleaved: Vec<f32>,
    /// Mono-mixed samples for waveform display and processing.
    pub mono: Vec<f32>,
    /// Sample rate in Hz.
    pub sample_rate: u32,
    /// Number of channels in the interleaved buffer.
    pub channels: u16,
    /// Total number of frames (= mono.len()).
    pub total_frames: usize,
}

/// Info about an AudioBuffer, serializable to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioBufferInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub total_frames: usize,
    pub duration_secs: f64,
}

impl AudioBuffer {
    /// Create a new AudioBuffer from interleaved samples.
    ///
    /// Automatically computes the mono mix from the interleaved data.
    pub fn new(interleaved: Vec<f32>, sample_rate: u32, channels: u16) -> Self {
        let mono = if channels == 1 {
            interleaved.clone()
        } else {
            super::decoder::mix_to_mono(&interleaved, channels)
        };

        let total_frames = mono.len();

        Self {
            interleaved,
            mono,
            sample_rate,
            channels,
            total_frames,
        }
    }

    /// Get a slice of interleaved audio data for playback.
    ///
    /// `start` and `length` are in frames (not samples).
    /// Returns the interleaved samples for the requested range.
    pub fn get_interleaved_range(&self, start_frame: usize, num_frames: usize) -> &[f32] {
        let ch = self.channels as usize;
        let start_sample = start_frame * ch;
        let end_sample = ((start_frame + num_frames) * ch).min(self.interleaved.len());

        if start_sample >= self.interleaved.len() {
            return &[];
        }

        &self.interleaved[start_sample..end_sample]
    }

    /// Get a slice of mono samples.
    pub fn get_mono_range(&self, start: usize, length: usize) -> &[f32] {
        let end = (start + length).min(self.mono.len());
        if start >= self.mono.len() {
            return &[];
        }
        &self.mono[start..end]
    }

    /// Generate a downsampled waveform for display.
    ///
    /// Returns `num_points` values representing the peak amplitude at
    /// evenly spaced positions throughout the track. Each point is the
    /// maximum absolute value in its corresponding window.
    pub fn generate_waveform(&self, num_points: usize) -> Vec<f32> {
        if self.mono.is_empty() || num_points == 0 {
            return vec![];
        }

        let total = self.mono.len();
        if num_points >= total {
            // More points requested than samples — just return abs values
            return self.mono.iter().map(|s| s.abs()).collect();
        }

        let window_size = total as f64 / num_points as f64;
        let mut waveform = Vec::with_capacity(num_points);

        for i in 0..num_points {
            let start = (i as f64 * window_size) as usize;
            let end = ((i + 1) as f64 * window_size) as usize;
            let end = end.min(total);

            let peak = self.mono[start..end]
                .iter()
                .map(|s| s.abs())
                .fold(0.0f32, f32::max);

            waveform.push(peak);
        }

        waveform
    }

    /// Duration in seconds.
    pub fn duration_secs(&self) -> f64 {
        self.total_frames as f64 / self.sample_rate as f64
    }

    /// Get buffer info for serialization.
    pub fn info(&self) -> AudioBufferInfo {
        AudioBufferInfo {
            sample_rate: self.sample_rate,
            channels: self.channels,
            total_frames: self.total_frames,
            duration_secs: self.duration_secs(),
        }
    }
}
