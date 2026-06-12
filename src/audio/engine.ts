import { guess } from 'web-audio-beat-detector';
import { detectKey } from './keyDetector';
import { useAppStore, updateDeckState, updateTrackInPlaylists, deckA, deckB } from '../store/useAppStore';

export class AudioEngine {
  private static instance: AudioEngine;
  private ctx: AudioContext;
  
  // Deck chains
  private deckA: DeckChain;
  private deckB: DeckChain;
  
  // Crossfader
  private crossfaderVal = 0.5;

  private constructor() {
    this.ctx = new AudioContext();
    this.deckA = new DeckChain(this.ctx, 'A');
    this.deckB = new DeckChain(this.ctx, 'B');
    
    this.deckA.connect(this.ctx.destination);
    this.deckB.connect(this.ctx.destination);
    
    this.setCrossfader(0.5);
  }

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  getContext() {
    return this.ctx;
  }

  getDeck(id: 'A' | 'B') {
    return id === 'A' ? this.deckA : this.deckB;
  }

  setCrossfader(value: number) {
    this.crossfaderVal = Math.max(0, Math.min(1, value));
    
    const gainA = Math.cos(this.crossfaderVal * Math.PI / 2);
    const gainB = Math.sin(this.crossfaderVal * Math.PI / 2);
    
    const now = this.ctx.currentTime;
    this.deckA.setCrossfaderGain(gainA, now);
    this.deckB.setCrossfaderGain(gainB, now);
  }
}

export class DeckChain {
  private ctx: AudioContext;
  
  private masterGain: GainNode;
  private crossfaderGain: GainNode;
  
  private eqLow: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqHigh: BiquadFilterNode;
  private filter: BiquadFilterNode;
  
  private analyser: AnalyserNode;

  private audioElement: HTMLAudioElement | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private blobUrl: string | null = null;
  private isPlaying = false;
  private playbackRate = 1.0;

  private deckId: 'A' | 'B';

  // Stems approach
  private isStemMode = false;
  private stemSources: Record<string, AudioBufferSourceNode | null> = { vocals: null, drums: null, bass: null, other: null };
  private stemGains: Record<string, GainNode> = {};
  private stemStartTime = 0;
  private stemOffset = 0;

  // Waveform visualization
  private peaks: Float32Array | null = null;

  constructor(ctx: AudioContext, deckId: 'A' | 'B') {
    this.ctx = ctx;
    this.deckId = deckId;
    
    // Create nodes
    this.masterGain = ctx.createGain();
    this.crossfaderGain = ctx.createGain();
    
    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 320;
    
    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 0.5;
    
    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 3200;
    
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'allpass';
    
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    // Create stem gain nodes
    ['vocals', 'drums', 'bass', 'other'].forEach(stem => {
      const gain = ctx.createGain();
      gain.gain.value = 1.0;
      gain.connect(this.masterGain);
      this.stemGains[stem] = gain;
    });

    // Connect EQ/filter chain:
    // MediaSource/Stems -> MasterGain -> EQLow -> EQMid -> EQHigh -> Filter -> CrossfaderGain -> Analyser -> Destination
    this.masterGain.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.filter);
    this.filter.connect(this.crossfaderGain);
    this.crossfaderGain.connect(this.analyser);
  }

  connect(destination: AudioNode) {
    this.analyser.connect(destination);
  }

  setVolume(val: number) {
    this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.01);
  }

  setCrossfaderGain(val: number, time: number) {
    this.crossfaderGain.gain.setTargetAtTime(val, time, 0.01);
  }

  setEQ(band: 'low' | 'mid' | 'high', val: number) {
    const node = band === 'low' ? this.eqLow : band === 'mid' ? this.eqMid : this.eqHigh;
    node.gain.setTargetAtTime(val, this.ctx.currentTime, 0.01);
  }
  
  setFilter(val: number) {
    if (Math.abs(val) < 0.05) {
      this.filter.type = 'allpass';
    } else if (val > 0) {
      this.filter.type = 'highpass';
      this.filter.frequency.value = 20 * Math.pow(500, val);
    } else {
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 20000 * Math.pow(0.001, Math.abs(val));
    }
  }

  setPitch(val: number) {
    this.playbackRate = val;
    if (this.audioElement) {
      this.audioElement.playbackRate = val;
    }
    // For Stems mode
    if (this.isStemMode && this.isPlaying) {
      Object.values(this.stemSources).forEach(source => {
        if (source) source.playbackRate.value = val;
      });
    }
  }

  setKeyLock(enabled: boolean) {
    if (this.audioElement) {
      this.audioElement.preservesPitch = enabled;
    }
  }

  seek(timeSec: number) {
    if (!this.audioElement) return;
    const duration = this.getDuration();
    if (duration === 0) return;
    
    // Clamp time
    let targetTime = Math.max(0, Math.min(timeSec, duration));
    this.audioElement.currentTime = targetTime;
    
    // Update stems if playing
    if (this.isStemMode) {
      // Re-sync stems
      this.stemStartTime = this.ctx.currentTime - (targetTime / this.playbackRate);
      this.stemOffset = targetTime;
      
      if (this.isPlaying) {
        // Stop current nodes
        Object.values(this.stemSources).forEach(src => {
          if (src) {
            try { src.stop(); } catch(e) {}
          }
        });
        
        // Re-create and start
        Object.keys(this.stemSources).forEach(stem => {
          if (this.stemSources[stem] && this.stemSources[stem]!.buffer) {
            const src = this.ctx.createBufferSource();
            src.buffer = this.stemSources[stem]!.buffer;
            src.playbackRate.value = this.playbackRate;
            src.connect(this.stemGains[stem]);
            src.start(0, this.stemOffset);
            this.stemSources[stem] = src;
          }
        });
      }
    }
  }

  /**
   * Load raw audio bytes (M4A, WebM, MP3, etc.) into this deck.
   * Creates a Blob URL and an HTML Audio element for playback.
   * The audio element is routed through the Web Audio API graph
   * via MediaElementAudioSourceNode.
   */
  async loadFromBytes(bytes: ArrayBuffer): Promise<void> {
    // Clean up previous audio
    this.cleanup();

    // Auto-detect MIME type from file magic bytes
    const header = new Uint8Array(bytes, 0, 12);
    let mimeType = 'audio/mp4'; // default
    
    // Check for WebM/MKV magic: 0x1A 0x45 0xDF 0xA3
    if (header[0] === 0x1A && header[1] === 0x45 && header[2] === 0xDF && header[3] === 0xA3) {
      mimeType = 'audio/webm';
    }
    // Check for Ogg magic: 'OggS'
    else if (header[0] === 0x4F && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53) {
      mimeType = 'audio/ogg';
    }
    // Check for MP3: ID3 tag or sync word 0xFFE0+
    else if ((header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) || (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0)) {
      mimeType = 'audio/mpeg';
    }
    // Check for M4A/MP4: 'ftyp' at offset 4
    else if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) {
      mimeType = 'audio/mp4';
    }

    console.log(`Audio format detected: ${mimeType}, size: ${bytes.byteLength} bytes`);

    const blob = new Blob([bytes], { type: mimeType });
    this.blobUrl = URL.createObjectURL(blob);

    this.audioElement = new Audio();
    this.audioElement.preload = 'auto';
    this.audioElement.src = this.blobUrl;

    // Connect to Web Audio API graph
    this.mediaSource = this.ctx.createMediaElementSource(this.audioElement);
    this.mediaSource.connect(this.masterGain);
    
    // Start peak extraction in the background
    this.extractPeaks(bytes).catch(err => {
      console.error('Failed to extract peaks:', err);
    });

    console.log('Audio element created — routed through Web Audio API (EQ/Crossfader active)');

    // Wait for GStreamer/WebKit to finish parsing the file and buffering
    return new Promise((resolve, reject) => {
      if (!this.audioElement) return reject(new Error("Audio element disappeared"));

      const onCanPlay = () => {
        console.log('Audio is ready to play (canplay event fired)');
        cleanupListeners();
        resolve();
      };

      const onError = (e: Event) => {
        console.error('Audio element error:', this.audioElement?.error);
        cleanupListeners();
        reject(new Error("Failed to load audio element: " + this.audioElement?.error?.message));
      };

      const cleanupListeners = () => {
        if (!this.audioElement) return;
        this.audioElement.removeEventListener('canplay', onCanPlay);
        this.audioElement.removeEventListener('error', onError);
      };

      this.audioElement.addEventListener('canplay', onCanPlay);
      this.audioElement.addEventListener('error', onError);

      // Force load
      this.audioElement.load();
    });
  }

  private async analyzeTrack(audioBuf: AudioBuffer) {
    try {
      console.log(`Analyzing BPM and Phase for Deck ${this.deckId}...`);
      const { bpm, offset } = await guess(audioBuf);
      console.log(`BPM for Deck ${this.deckId}: ${bpm}, Offset: ${offset}`);
      
      console.log(`Analyzing Key for Deck ${this.deckId}...`);
      const key = await detectKey(audioBuf);
      console.log(`Key for Deck ${this.deckId}: ${key}`);
      
      const originalBpm = Math.round(bpm * 10) / 10;
      
      updateDeckState(this.deckId, { 
        originalBpm, 
        offset,
        key 
      });

      // Update the track in the playlist if it was loaded from there
      const myState = this.deckId === 'A' ? deckA : deckB;
      if (myState.metadata?.id) {
        updateTrackInPlaylists(myState.metadata.id, { bpm: originalBpm, key });
      }
    } catch (e) {
      console.error('Failed to analyze track:', e);
    }
  }

  /**
   * Extract min/max peaks for the entire track to draw a static waveform.
   */
  private async extractPeaks(bytes: ArrayBuffer) {
    console.log('Extracting peaks in background...');
    const copy = bytes.slice(0); // Copy to avoid detaching the ArrayBuffer
    const audioBuf = await this.ctx.decodeAudioData(copy);
    
    // Fire analysis in background without blocking
    this.analyzeTrack(audioBuf);
    
    // We mix down to mono for the waveform visualization
    const channelData = audioBuf.getChannelData(0);
    
    // We want a high-resolution peak array (8000 points) for smooth scrolling
    const POINTS = 8000;
    const blockSize = Math.floor(channelData.length / POINTS);
    const peaks = new Float32Array(POINTS * 2);
    
    for (let i = 0; i < POINTS; i++) {
      let min = 1.0;
      let max = -1.0;
      const start = i * blockSize;
      const end = start + blockSize;
      
      for (let j = start; j < end; j++) {
        const val = channelData[j];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      
      peaks[i * 2] = min;
      peaks[i * 2 + 1] = max;
    }
    
    this.peaks = peaks;
    console.log('Peak extraction complete');
  }

  syncTo(targetDeck: DeckChain) {
    const myState = this.deckId === 'A' ? deckA : deckB;
    const targetState = targetDeck.deckId === 'A' ? deckA : deckB;

    if (!myState.originalBpm || !targetState.originalBpm || !targetState.playing) return;

    // 1. Tempo Sync
    const targetLiveBpm = targetState.originalBpm * targetState.pitch;
    const newPitch = targetLiveBpm / myState.originalBpm;
    
    this.setPlaybackRate(newPitch);
    updateDeckState(this.deckId, { pitch: newPitch });

    // 2. Phase Sync (Nudge)
    if (myState.offset !== null && targetState.offset !== null) {
      const beatDurationA = 60 / targetLiveBpm; // duration of one beat in unpitched time? No!
      
      // The track's internal timeline runs at its original BPM.
      // So the beat duration in the track's internal timeline is:
      const beatDurationM = 60 / myState.originalBpm;
      const beatDurationT = 60 / targetState.originalBpm;

      const currentTimeT = targetDeck.getCurrentTime();
      // phase of target in its own timeline
      let phaseT = (currentTimeT - targetState.offset) % beatDurationT;
      if (phaseT < 0) phaseT += beatDurationT;
      
      // Normalized phase (0 to 1)
      const normPhase = phaseT / beatDurationT;

      const currentTimeM = this.getCurrentTime();
      let phaseM = (currentTimeM - myState.offset) % beatDurationM;
      if (phaseM < 0) phaseM += beatDurationM;

      const currentNormPhase = phaseM / beatDurationM;

      // Difference in normalized phase
      let diffNorm = normPhase - currentNormPhase;
      if (diffNorm > 0.5) diffNorm -= 1.0;
      if (diffNorm < -0.5) diffNorm += 1.0;

      // Difference in seconds in my track's timeline
      const diffSec = diffNorm * beatDurationM;

      this.seek(currentTimeM + diffSec);
      console.log(`Synced Deck ${this.deckId} to Deck ${targetDeck.deckId} (Adjusted by ${diffSec.toFixed(3)}s)`);
    }
  }

  private cleanup() {
    this.pause();
    if (this.mediaSource) {
      this.mediaSource.disconnect();
      this.mediaSource = null;
    }
    if (this.audioElement) {
      this.audioElement.src = '';
      this.audioElement.remove();
      this.audioElement = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.isStemMode = false;
    Object.values(this.stemSources).forEach(src => {
      if (src) {
        src.stop();
        src.disconnect();
      }
    });
    this.stemSources = { vocals: null, drums: null, bass: null, other: null };
    this.stemOffset = 0;
    this.peaks = null;
  }

  async loadStems(vocals: ArrayBuffer, drums: ArrayBuffer, bass: ArrayBuffer, other: ArrayBuffer) {
    console.log('Decoding 4 stem files...');
    const [vBuf, dBuf, bBuf, oBuf] = await Promise.all([
      this.ctx.decodeAudioData(vocals.slice(0)),
      this.ctx.decodeAudioData(drums.slice(0)),
      this.ctx.decodeAudioData(bass.slice(0)),
      this.ctx.decodeAudioData(other.slice(0)),
    ]);

    const currentTime = this.getCurrentTime();
    const wasPlaying = this.isPlaying;

    if (wasPlaying) {
      this.pause();
    }
    this.isStemMode = true;

    if (this.mediaSource) {
      this.mediaSource.disconnect();
    }
    if (this.audioElement) {
      this.audioElement.muted = true;
    }

    const buffers: Record<string, AudioBuffer> = { vocals: vBuf, drums: dBuf, bass: bBuf, other: oBuf };
    Object.keys(buffers).forEach(stem => {
      const src = this.ctx.createBufferSource();
      src.buffer = buffers[stem];
      src.connect(this.stemGains[stem]);
      this.stemSources[stem] = src;
    });

    this.stemOffset = currentTime;

    if (wasPlaying) {
      this.play();
    }
    console.log(`Transitioned to stem mode at ${currentTime}s`);
  }

  setStemVolume(stem: string, value: number) {
    if (this.stemGains[stem]) {
      this.stemGains[stem].gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
    }
  }

  async play() {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    if (this.isStemMode) {
      const now = this.ctx.currentTime;
      Object.keys(this.stemSources).forEach(stem => {
        const src = this.ctx.createBufferSource();
        src.buffer = this.stemSources[stem]!.buffer;
        src.playbackRate.value = this.playbackRate;
        src.connect(this.stemGains[stem]);
        src.start(now, this.stemOffset);
        this.stemSources[stem] = src;
      });
      this.stemStartTime = now - (this.stemOffset / this.playbackRate);
      this.isPlaying = true;
      console.log('Stem playback started');
    } else if (this.audioElement) {
      this.audioElement.playbackRate = this.playbackRate;
      try {
        await this.audioElement.play();
        this.isPlaying = true;
      } catch (err) {
        console.error('audioElement.play() FAILED:', err);
      }
    }
  }

  pause() {
    if (!this.isPlaying) return;
    if (this.isStemMode) {
      const now = this.ctx.currentTime;
      this.stemOffset += (now - this.stemStartTime) * this.playbackRate;
      Object.values(this.stemSources).forEach(src => {
        if (src) {
          src.stop(now);
          src.disconnect();
        }
      });
      this.isPlaying = false;
      console.log('Stem playback paused');
    } else if (this.audioElement) {
      this.audioElement.pause();
      this.isPlaying = false;
    }
  }
  
  stop() {
    if (this.isStemMode) {
      this.pause();
      this.stemOffset = 0;
    } else if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
    }
    this.isPlaying = false;
    console.log('Stopped');
  }

  setPlaybackRate(rate: number) {
    this.playbackRate = rate;
    if (this.isStemMode && this.isPlaying) {
      const now = this.ctx.currentTime;
      this.stemOffset += (now - this.stemStartTime) * this.playbackRate; // Recalculate offset with old rate
      this.stemStartTime = now - (this.stemOffset / rate); // Update start time with new rate
      Object.values(this.stemSources).forEach(src => {
        if (src) src.playbackRate.value = rate;
      });
    } else if (this.audioElement) {
      this.audioElement.playbackRate = rate;
    }
  }

  getAnalyser() {
    return this.analyser;
  }

  getPeaks() {
    return this.peaks;
  }

  getCurrentTime() {
    if (this.isStemMode && this.isPlaying) {
      return (this.ctx.currentTime - this.stemStartTime) * this.playbackRate;
    } else if (this.isStemMode) {
      return this.stemOffset;
    }
    return this.audioElement ? this.audioElement.currentTime : 0;
  }

  getDuration() {
    if (this.isStemMode && this.stemSources['vocals']) {
      return this.stemSources['vocals'].buffer?.duration || 0;
    }
    return this.audioElement?.duration || 0;
  }

  isLoaded(): boolean {
    return this.isStemMode || this.audioElement !== null;
  }
}
