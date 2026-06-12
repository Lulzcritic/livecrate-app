//! Audio decoding with symphonia.
//!
//! Decodes raw audio bytes (Opus/WebM, AAC/M4A, MP3) into interleaved f32
//! samples using symphonia's codec infrastructure. All decoding happens
//! in memory — the source bytes come from yt-dlp and the output stays in RAM.

use std::io::Cursor;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Result of decoding an audio stream.
#[derive(Debug, Clone)]
pub struct DecodedAudio {
    /// Interleaved f32 samples, normalized to [-1.0, 1.0].
    pub samples: Vec<f32>,
    /// Sample rate in Hz (e.g. 44100, 48000).
    pub sample_rate: u32,
    /// Number of audio channels (1 = mono, 2 = stereo).
    pub channels: u16,
    /// Total number of frames (samples per channel).
    pub total_frames: usize,
}

/// Errors that can occur during audio decoding.
#[derive(Debug, thiserror::Error)]
pub enum DecodeError {
    #[error("No supported audio track found in the stream")]
    NoTrack,

    #[error("Unsupported codec: {0}")]
    UnsupportedCodec(String),

    #[error("Symphonia error: {0}")]
    SymphoniaError(String),

    #[error("No audio samples were decoded")]
    EmptyOutput,
}

/// Decode raw audio bytes into interleaved f32 samples.
///
/// Supports Opus (WebM/OGG), AAC (MP4/M4A), MP3, and Vorbis containers.
/// The `format_hint` can optionally specify the container format
/// (e.g. "webm", "m4a", "mp3").
pub fn decode_audio_bytes(
    data: &[u8],
    format_hint: Option<&str>,
) -> Result<DecodedAudio, DecodeError> {
    // Wrap the byte slice in a cursor for MediaSourceStream
    let cursor = Cursor::new(data.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    // Build format hint from extension if provided
    let mut hint = Hint::new();
    if let Some(ext) = format_hint {
        hint.with_extension(ext);
    }

    // Probe the format
    let format_opts = FormatOptions {
        enable_gapless: true,
        ..Default::default()
    };
    let metadata_opts = MetadataOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| DecodeError::SymphoniaError(format!("Probe failed: {}", e)))?;

    let mut format = probed.format;

    // Find the first audio track
    let track = format
        .tracks()
        .iter()
        .find(|t| {
            t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL
        })
        .ok_or(DecodeError::NoTrack)?;

    let track_id = track.id;
    let codec_params = track.codec_params.clone();

    let sample_rate = codec_params
        .sample_rate
        .ok_or_else(|| DecodeError::SymphoniaError("Unknown sample rate".into()))?;

    let channels = codec_params
        .channels
        .map(|c| c.count() as u16)
        .unwrap_or(2);

    // Create the decoder
    let decoder_opts = DecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &decoder_opts)
        .map_err(|e| DecodeError::UnsupportedCodec(format!("{}", e)))?;

    // Decode all packets into interleaved f32 samples
    let mut all_samples: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                // End of stream
                break;
            }
            Err(symphonia::core::errors::Error::ResetRequired) => {
                // Some formats require a reset after seeking
                log::warn!("Decoder reset required, skipping packet");
                continue;
            }
            Err(e) => {
                log::warn!("Error reading packet: {}", e);
                break;
            }
        };

        // Skip packets from other tracks
        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf_ref) => {
                // Initialize the sample buffer on first successful decode
                if sample_buf.is_none() {
                    let spec = *audio_buf_ref.spec();
                    let duration = audio_buf_ref.capacity() as u64;
                    sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
                }

                if let Some(ref mut buf) = sample_buf {
                    // Copy decoded samples into the sample buffer
                    buf.copy_interleaved_ref(audio_buf_ref);
                    // Extend our accumulated samples
                    all_samples.extend_from_slice(buf.samples());
                }
            }
            Err(symphonia::core::errors::Error::DecodeError(e)) => {
                log::warn!("Decode error (skipping packet): {}", e);
                continue;
            }
            Err(e) => {
                log::error!("Fatal decode error: {}", e);
                break;
            }
        }
    }

    if all_samples.is_empty() {
        return Err(DecodeError::EmptyOutput);
    }

    let total_frames = all_samples.len() / channels as usize;

    log::info!(
        "Decoded {} frames ({} samples) at {}Hz, {} channels",
        total_frames,
        all_samples.len(),
        sample_rate,
        channels
    );

    Ok(DecodedAudio {
        samples: all_samples,
        sample_rate,
        channels,
        total_frames,
    })
}

/// Mix a multi-channel interleaved buffer down to mono.
///
/// Averages all channels for each frame.
pub fn mix_to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels == 1 {
        return samples.to_vec();
    }

    let ch = channels as usize;
    let num_frames = samples.len() / ch;
    let mut mono = Vec::with_capacity(num_frames);

    for frame in 0..num_frames {
        let offset = frame * ch;
        let sum: f32 = samples[offset..offset + ch].iter().sum();
        mono.push(sum / channels as f32);
    }

    mono
}

/// Resample audio to a target sample rate using rubato.
///
/// Takes mono f32 samples and resamples them.
pub fn resample(
    samples: &[f32],
    from_rate: u32,
    to_rate: u32,
) -> Result<Vec<f32>, DecodeError> {
    if from_rate == to_rate {
        return Ok(samples.to_vec());
    }

    use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = to_rate as f64 / from_rate as f64;
    let chunk_size = 1024;

    let mut resampler = SincFixedIn::<f32>::new(
        ratio,
        2.0, // max relative ratio (for variable rate, not used here)
        params,
        chunk_size,
        1, // mono channel
    )
    .map_err(|e| DecodeError::SymphoniaError(format!("Resampler init error: {}", e)))?;

    let mut output_samples: Vec<f32> = Vec::new();
    let mut position = 0;

    while position < samples.len() {
        let end = (position + chunk_size).min(samples.len());
        let mut chunk = samples[position..end].to_vec();

        // Pad the last chunk if it's shorter than chunk_size
        if chunk.len() < chunk_size {
            chunk.resize(chunk_size, 0.0);
        }

        let input = vec![chunk];
        let result = resampler
            .process(&input, None)
            .map_err(|e| DecodeError::SymphoniaError(format!("Resample error: {}", e)))?;

        if let Some(channel) = result.first() {
            output_samples.extend_from_slice(channel);
        }

        position += chunk_size;
    }

    // Trim to approximate expected length
    let expected_len = (samples.len() as f64 * ratio).ceil() as usize;
    output_samples.truncate(expected_len);

    Ok(output_samples)
}
