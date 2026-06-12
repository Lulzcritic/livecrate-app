//! ONNX Runtime session manager for HTDemucs stem separation.
//!
//! Initializes an ONNX Runtime session with DirectML (GPU) acceleration,
//! falling back to CPU if DirectML is not available. The session is lazily
//! initialized on first use.

use std::sync::Arc;

use ort::session::{Session, builder::GraphOptimizationLevel};
use parking_lot::RwLock;

/// Errors from the stem separation engine.
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("ONNX Runtime error: {0}")]
    OrtError(String),

    #[error("Model file not found at: {0}")]
    ModelNotFound(String),

    #[error("Engine not initialized — call init() first")]
    NotInitialized,

    #[error("Inference error: {0}")]
    InferenceError(String),
}

impl From<ort::Error> for EngineError {
    fn from(e: ort::Error) -> Self {
        EngineError::OrtError(e.to_string())
    }
}

/// Manages the ONNX Runtime session for stem separation.
///
/// The engine is designed to be shared across threads via `Arc<RwLock<>>`.
/// It lazily initializes the session on first use with DirectML → CPU fallback.
pub struct StemEngine {
    session: Option<Session>,
    model_path: String,
    is_gpu: bool,
}

impl StemEngine {
    /// Create a new engine pointing at the given ONNX model path.
    ///
    /// Does NOT load the model yet — call `init()` to do that.
    pub fn new(model_path: &str) -> Self {
        Self {
            session: None,
            model_path: model_path.to_string(),
            is_gpu: false,
        }
    }

    /// Initialize the ONNX session.
    ///
    /// Tries DirectML (GPU) first, falls back to CPU if unavailable.
    pub fn init(&mut self) -> Result<(), EngineError> {
        // Verify the model file exists
        if !std::path::Path::new(&self.model_path).exists() {
            return Err(EngineError::ModelNotFound(self.model_path.clone()));
        }

        // Try DirectML first (Windows GPU acceleration)
        match self.try_init_directml() {
            Ok(session) => {
                log::info!("ONNX session initialized with DirectML (GPU)");
                self.session = Some(session);
                self.is_gpu = true;
                Ok(())
            }
            Err(e) => {
                log::warn!("DirectML init failed ({}), falling back to CPU", e);
                self.try_init_cpu()
            }
        }
    }

    /// Try to initialize with DirectML execution provider.
    fn try_init_directml(&self) -> Result<Session, EngineError> {
        let mut builder = Session::builder()
            .map_err(|e| EngineError::OrtError(e.to_string()))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| EngineError::OrtError(e.to_string()))?
            .with_intra_threads(4)
            .map_err(|e| EngineError::OrtError(e.to_string()))?;
            
        let session = builder.commit_from_file(&self.model_path)
            .map_err(|e| EngineError::OrtError(e.to_string()))?;

        Ok(session)
    }

    /// Initialize with CPU-only execution.
    fn try_init_cpu(&mut self) -> Result<(), EngineError> {
        let mut builder = Session::builder()
            .map_err(|e| EngineError::OrtError(e.to_string()))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| EngineError::OrtError(e.to_string()))?
            .with_intra_threads(num_cpus())
            .map_err(|e| EngineError::OrtError(e.to_string()))?;
            
        let session = builder.commit_from_file(&self.model_path)
            .map_err(|e| EngineError::OrtError(e.to_string()))?;

        log::info!("ONNX session initialized with CPU provider");
        self.session = Some(session);
        self.is_gpu = false;
        Ok(())
    }

    /// Check if the engine has been initialized.
    pub fn is_initialized(&self) -> bool {
        self.session.is_some()
    }

    /// Whether the session is using GPU acceleration.
    pub fn is_gpu(&self) -> bool {
        self.is_gpu
    }

    /// Get a reference to the underlying ONNX session.
    pub fn session(&self) -> Result<&Session, EngineError> {
        self.session.as_ref().ok_or(EngineError::NotInitialized)
    }

    /// Run inference on a batch of audio chunks.
    ///
    /// Input: `[batch, channels, time]` tensor of f32 audio.
    /// Output: `[batch, stems, channels, time]` tensor of separated stems.
    ///
    /// TODO: Full HTDemucs inference with proper chunking and overlap-add.
    /// For the PoC, this is stubbed — returns the input duplicated across
    /// 4 stems (vocals, drums, bass, other).
    pub fn separate(
        &self,
        audio: &ndarray::Array2<f32>,
    ) -> Result<ndarray::Array3<f32>, EngineError> {
        let _session = self.session()?;

        let (channels, time_steps) = audio.dim();

        // TODO: Implement actual ONNX inference:
        // 1. Prepare input tensor [1, channels, time_steps]
        // 2. Run session.run() with the input
        // 3. Extract output tensor [1, 4, channels, time_steps]
        // 4. Return the stem-separated audio
        //
        // For now, stub: create 4 copies of the input (one per stem).
        // This lets the full pipeline work end-to-end while we integrate
        // the actual model.

        log::warn!("Stem separation is STUBBED — returning input audio as all stems");

        let num_stems = 4; // vocals, drums, bass, other
        let mut output = ndarray::Array3::<f32>::zeros((num_stems, channels, time_steps));

        for stem_idx in 0..num_stems {
            for ch in 0..channels {
                for t in 0..time_steps {
                    // Divide by 4 so stems sum back to original
                    output[[stem_idx, ch, t]] = audio[[ch, t]] / num_stems as f32;
                }
            }
        }

        Ok(output)
    }
}

/// Global lazy-initialized stem engine.
/// Protected by RwLock for thread-safe access.
pub static STEM_ENGINE: std::sync::LazyLock<Arc<RwLock<StemEngine>>> =
    std::sync::LazyLock::new(|| {
        // Default model path — can be overridden before init
        Arc::new(RwLock::new(StemEngine::new("models/htdemucs.onnx")))
    });

/// Get the number of available CPU threads (capped at 8 for performance).
fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|p| p.get().min(8))
        .unwrap_or(4)
}
