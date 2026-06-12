import { invoke } from '@tauri-apps/api/core';

export interface TrackResult {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

export interface TrackMetadata {
  title: string;
  artist: string;
  durationSecs: number;
  sampleRate: number;
  channels: number;
  totalSamples: number;
}

export interface DeckStatus {
  loaded: boolean;
  stems_ready: boolean;
  stems_progress: number;
  duration: number;
}

export async function searchYoutube(query: string): Promise<TrackResult[]> {
  try {
    return await invoke<TrackResult[]>('search_youtube', { query });
  } catch (error) {
    console.error('Error searching YouTube:', error);
    throw error;
  }
}

export async function loadTrack(url: string, deckId: string): Promise<TrackMetadata> {
  try {
    return await invoke<TrackMetadata>('load_track', { url, deckId });
  } catch (error) {
    console.error(`Error loading track on deck ${deckId}:`, error);
    throw error;
  }
}

export async function loadTrackRaw(deckId: string): Promise<ArrayBuffer> {
  try {
    const data = await invoke<any>('load_track_raw', { deckId });
    if (data instanceof ArrayBuffer) {
      return data;
    } else if (data instanceof Uint8Array) {
      // Create a proper copy to avoid detached buffer issues
      const copy = new Uint8Array(data);
      return copy.buffer;
    } else if (Array.isArray(data)) {
      return new Uint8Array(data).buffer;
    } else {
      throw new Error("Unexpected data type received from load_track_raw: " + typeof data);
    }
  } catch (error) {
    console.error(`Error loading raw track on deck ${deckId}:`, error);
    throw error;
  }
}

export async function getAudioData(deckId: string, start: number, length: number): Promise<Float32Array> {
  try {
    const CHUNK_SIZE = 1000000; // 1 million frames per chunk
    const result = new Float32Array(length);
    
    let currentStart = start;
    let remaining = length;
    let offset = 0;
    
    while (remaining > 0) {
      const chunkLength = Math.min(remaining, CHUNK_SIZE);
      const data = await invoke<any>('get_audio_data', { deckId, start: currentStart, length: chunkLength });
      
      let chunkFloat: Float32Array;
      if (data instanceof ArrayBuffer) {
        chunkFloat = new Float32Array(data);
      } else if (data instanceof Uint8Array) {
        chunkFloat = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
      } else if (Array.isArray(data)) {
        const u8 = new Uint8Array(data);
        chunkFloat = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
      } else {
        throw new Error("Unexpected data type");
      }
      
      if (chunkFloat.length === 0) break;
      
      // Copy chunk into pre-allocated result array
      result.set(chunkFloat, offset);
      
      offset += chunkFloat.length;
      currentStart += chunkFloat.length;
      remaining -= chunkFloat.length;
      
      // If we got less than requested, the track must have ended
      if (chunkFloat.length < chunkLength) break;
    }
    
    // Sanitize the entire array to ensure NO NaNs or Infinities crash the Web Audio BiquadFilters
    for (let i = 0; i < result.length; i++) {
      if (!Number.isFinite(result[i])) {
        result[i] = 0;
      }
    }
    
    return offset === length ? result : result.subarray(0, offset);
  } catch (error) {
    console.error(`Error getting audio data for deck ${deckId}:`, error);
    throw error;
  }
}

export async function getWaveformData(deckId: string, numPoints: number): Promise<Float32Array> {
  try {
    const data = await invoke<number[]>('get_waveform_data', { deckId, numPoints });
    return new Float32Array(data);
  } catch (error) {
    console.error(`Error getting waveform data for deck ${deckId}:`, error);
    throw error;
  }
}

export async function separateStems(deckId: string): Promise<void> {
  try {
    await invoke<void>('separate_stems', { deckId });
  } catch (error) {
    console.error(`Error separating stems for deck ${deckId}:`, error);
    throw error;
  }
}

export async function getStemData(deckId: string, stem: string): Promise<ArrayBuffer> {
  try {
    const data = await invoke<any>('get_stem_data', { deckId, stem });
    if (data instanceof ArrayBuffer) {
      return data;
    } else if (data instanceof Uint8Array) {
      const copy = new Uint8Array(data);
      return copy.buffer;
    } else if (Array.isArray(data)) {
      return new Uint8Array(data).buffer;
    } else {
      throw new Error("Unexpected data type received from get_stem_data: " + typeof data);
    }
  } catch (error) {
    console.error(`Error getting stem data for deck ${deckId}, stem ${stem}:`, error);
    throw error;
  }
}

export async function getDeckStatus(deckId: string): Promise<DeckStatus> {
  try {
    return await invoke<DeckStatus>('get_deck_status', { deckId });
  } catch (error) {
    console.error(`Error getting deck status for deck ${deckId}:`, error);
    throw error;
  }
}

export async function checkStemModel(): Promise<boolean> {
  try {
    return await invoke<boolean>('check_stem_model');
  } catch (error) {
    console.error('Error checking stem model:', error);
    return false;
  }
}

export async function downloadStemModel(): Promise<void> {
  try {
    await invoke<void>('download_stem_model');
  } catch (error) {
    console.error('Error downloading stem model:', error);
    throw error;
  }
}
