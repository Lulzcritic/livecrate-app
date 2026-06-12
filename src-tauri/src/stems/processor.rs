//! STFT / iSTFT processing and stem separation pipeline.
//!
//! This module handles the audio processing pipeline for stem separation:
//! 1. Convert audio to the model's expected sample rate (44100 Hz)
//! 2. Apply STFT (Short-Time Fourier Transform)
//! 3. Run through the ONNX model
//! 4. Apply iSTFT (Inverse STFT)
//! 5. Return separated stems
//!
//! For the PoC, STFT/iSTFT are stubbed with direct time-domain processing.

use ndarray::Array2;



use super::engine::{EngineError, STEM_ENGINE};

/// Result of stem separation: a map of stem type to mono f32 samples.
pub struct StemResult {
    pub vocals: Vec<f32>,
    pub drums: Vec<f32>,
    pub bass: Vec<f32>,
    pub other: Vec<f32>,
    pub sample_rate: u32,
}

/// Process audio buffer and separate into stems.
///
/// Takes mono or stereo f32 samples at any sample rate, resamples to
/// 44100 Hz (HTDemucs native rate), runs separation, and returns
/// individual stem buffers.
pub fn separate_stems(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
) -> Result<StemResult, EngineError> {
    // Target sample rate for HTDemucs
    let target_sr: u32 = 44100;

    // Step 1: Ensure we have stereo audio at 44100 Hz
    let stereo_samples = if channels == 1 {
        // Duplicate mono to stereo
        let mut stereo = Vec::with_capacity(samples.len() * 2);
        for &s in samples {
            stereo.push(s);
            stereo.push(s);
        }
        stereo
    } else if channels == 2 {
        samples.to_vec()
    } else {
        // Mix down to stereo (take first two channels)
        let ch = channels as usize;
        let num_frames = samples.len() / ch;
        let mut stereo = Vec::with_capacity(num_frames * 2);
        for frame in 0..num_frames {
            let offset = frame * ch;
            stereo.push(samples[offset]); // left
            stereo.push(samples[offset + 1.min(ch - 1)]); // right
        }
        stereo
    };

    let num_frames = stereo_samples.len() / 2;

    // Step 2: Resample to target sample rate if needed
    let (resampled, actual_sr) = if sample_rate != target_sr {
        // Resample each channel independently
        let mut left = Vec::with_capacity(num_frames);
        let mut right = Vec::with_capacity(num_frames);
        for i in 0..num_frames {
            left.push(stereo_samples[i * 2]);
            right.push(stereo_samples[i * 2 + 1]);
        }

        let left_rs = crate::audio::decoder::resample(&left, sample_rate, target_sr)
            .map_err(|e| EngineError::InferenceError(format!("Resample error: {}", e)))?;
        let right_rs = crate::audio::decoder::resample(&right, sample_rate, target_sr)
            .map_err(|e| EngineError::InferenceError(format!("Resample error: {}", e)))?;

        let rs_frames = left_rs.len().min(right_rs.len());
        let mut interleaved = Vec::with_capacity(rs_frames * 2);
        for i in 0..rs_frames {
            interleaved.push(left_rs[i]);
            interleaved.push(right_rs[i]);
        }

        (interleaved, target_sr)
    } else {
        (stereo_samples, sample_rate)
    };

    let rs_frames = resampled.len() / 2;

    // Step 3: Convert to ndarray [channels=2, time] for the model
    let mut audio_tensor = Array2::<f32>::zeros((2, rs_frames));
    for i in 0..rs_frames {
        audio_tensor[[0, i]] = resampled[i * 2];     // left
        audio_tensor[[1, i]] = resampled[i * 2 + 1]; // right
    }

    // Step 4: Run through the stem separation engine
    let engine = STEM_ENGINE.read();
    let stem_output = engine.separate(&audio_tensor)?;
    drop(engine);

    // stem_output shape: [4, 2, time] — 4 stems, 2 channels each
    // Mix each stem down to mono for storage
    let (n_stems, _n_ch, n_time) = stem_output.dim();

    let extract_mono = |stem_idx: usize| -> Vec<f32> {
        let mut mono = Vec::with_capacity(n_time);
        for t in 0..n_time {
            let left = stem_output[[stem_idx, 0, t]];
            let right = if _n_ch > 1 {
                stem_output[[stem_idx, 1, t]]
            } else {
                left
            };
            mono.push((left + right) * 0.5);
        }
        mono
    };

    // Step 5: If we resampled for the model, resample stems back to original rate
    let resample_back = |mono: Vec<f32>| -> Result<Vec<f32>, EngineError> {
        if actual_sr != sample_rate {
            crate::audio::decoder::resample(&mono, actual_sr, sample_rate)
                .map_err(|e| EngineError::InferenceError(format!("Resample back error: {}", e)))
        } else {
            Ok(mono)
        }
    };

    Ok(StemResult {
        vocals: resample_back(extract_mono(0))?,
        drums: resample_back(extract_mono(1))?,
        bass: resample_back(extract_mono(2))?,
        other: resample_back(extract_mono(if n_stems > 3 { 3 } else { 0 }))?,
        sample_rate,
    })
}

// ─── STFT / iSTFT Utilities ──────────────────────────────────────────────────
// TODO: Implement proper STFT and iSTFT for production HTDemucs inference.
// The model expects frequency-domain input and the full pipeline requires:
//
// 1. STFT with n_fft=4096, hop_length=1024, window=hann
//    - Apply windowing: frame[i] = sample[i] * window[i]
//    - Compute FFT of each frame
//    - Output: complex spectrogram [channels, freq_bins, time_frames]
//
// 2. Model inference on the spectrogram
//    - Input shape:  [batch=1, channels=2, freq=2049, time=T]
//    - Output shape: [batch=1, stems=4, channels=2, freq=2049, time=T]
//
// 3. iSTFT to convert back to time domain
//    - Inverse FFT each frame
//    - Overlap-add with hop_length=1024
//    - Normalize by window sum
//
// For the PoC, we bypass STFT entirely and pass time-domain audio
// directly through the engine's stub.

/// Hann window function for STFT.
#[allow(dead_code)]
fn hann_window(size: usize) -> Vec<f32> {
    (0..size)
        .map(|i| {
            let phase = 2.0 * std::f32::consts::PI * i as f32 / size as f32;
            0.5 * (1.0 - phase.cos())
        })
        .collect()
}
