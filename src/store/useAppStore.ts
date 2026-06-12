import { useState, useEffect } from 'react';

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationSecs: number;
  thumbnailUrl: string;
  url: string;
  key?: string;
  bpm?: number;
}

const trackCache = new Map<string, Track>();

export function processTrack(track: Track): Track {
  if (trackCache.has(track.id)) {
    const cached = trackCache.get(track.id)!;
    // Only update artist if it's "Unknown" in cached but found now, or vice versa
    const artist = cached.artist !== "Unknown" ? cached.artist : track.artist;
    const merged = { ...track, ...cached, artist };
    trackCache.set(track.id, merged);
    return merged;
  }
  trackCache.set(track.id, track);
  return track;
}

export function isKeyCompatible(key1?: string | null, key2?: string | null): boolean {
  if (!key1 || !key2) return false;
  
  const match1 = key1.match(/(\d+)([AB])/i);
  const match2 = key2.match(/(\d+)([AB])/i);
  if (!match1 || !match2) return false;

  const n1 = parseInt(match1[1]);
  const l1 = match1[2].toUpperCase();
  const n2 = parseInt(match2[1]);
  const l2 = match2[2].toUpperCase();

  if (n1 === n2 && l1 === l2) return true; // Same key
  if (n1 === n2 && l1 !== l2) return true; // Relative major/minor (e.g. 8A <-> 8B)
  
  if (l1 === l2) {
    // Adjacent on wheel
    const diff = Math.abs(n1 - n2);
    if (diff === 1 || diff === 11) return true; // 12 and 1 are adjacent
  }
  
  return false;
}

export function getActiveKey(store: { crossfader: number, deckA: DeckState, deckB: DeckState }): string | null {
  const volA = store.deckA.playing ? store.deckA.volume * (1 - store.crossfader) : 0;
  const volB = store.deckB.playing ? store.deckB.volume * store.crossfader : 0;
  
  if (volA === 0 && volB === 0) {
    if (store.deckA.loaded) return store.deckA.key;
    if (store.deckB.loaded) return store.deckB.key;
    return null;
  }
  return volA >= volB ? store.deckA.key : store.deckB.key;
}

export interface DeckState {
  id: 'A' | 'B';
  loaded: boolean;
  playing: boolean;
  volume: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  pitch: number;
  keyLock: boolean;
  originalBpm: number | null;
  key: string | null;
  offset: number | null;
  stemsStatus: 'none' | 'separating' | 'ready';
  stemVolumes: {
    vocals: number;
    drums: number;
    bass: number;
    other: number;
  };
  stemsProgress?: { percent: number; message: string };
  metadata: Track | null;
  isLoading: boolean;
  statusText: string;
  playlist: Track[];
  playlistName: string | null;
  currentTrackIndex: number;
}

export const initialDeckState = (id: 'A' | 'B'): DeckState => ({
  id,
  loaded: false,
  playing: false,
  volume: 1.0,
  eq: { low: 1, mid: 1, high: 1 },
  filter: 0,
  pitch: 1.0,
  keyLock: true,
  originalBpm: null,
  key: null,
  offset: null,
  stemsStatus: 'none',
  stemVolumes: { vocals: 1, drums: 1, bass: 1, other: 1 },
  metadata: null,
  isLoading: false,
  statusText: '',
  playlist: [],
  playlistName: null,
  currentTrackIndex: -1,
});

// Simple global state using React hooks and a singleton pattern for simplicity in this PoC
// In a real app, you'd use Zustand or Redux
let crossfader = 0.5;
export let deckA = { ...initialDeckState('A') };
export let deckB = { ...initialDeckState('B') };
export let globalError: string | null = null;

const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export const showError = (msg: string) => {
  globalError = msg;
  emit();
};

export const clearError = () => {
  globalError = null;
  emit();
};

export const useAppStore = () => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    globalError,
    crossfader,
    setCrossfader: (val: number) => {
      crossfader = val;
      emit();
    },
    deckA,
    updateDeckA: (update: Partial<DeckState>) => {
      deckA = { ...deckA, ...update };
      emit();
    },
    deckB,
    updateDeckB: (update: Partial<DeckState>) => {
      deckB = { ...deckB, ...update };
      emit();
    },
  };
};

export const updateDeckState = (id: 'A' | 'B', update: Partial<DeckState>) => {
  if (id === 'A') {
    deckA = { ...deckA, ...update };
  } else {
    deckB = { ...deckB, ...update };
  }
  emit();
};

export const updateTrackInPlaylists = (trackId: string, updates: Partial<Track>) => {
  if (trackCache.has(trackId)) {
    trackCache.set(trackId, { ...trackCache.get(trackId)!, ...updates });
  }

  const updatePlaylist = (playlist: Track[]) => 
    playlist.map(t => t.id === trackId ? { ...t, ...updates } : t);
  
  deckA = { ...deckA, playlist: updatePlaylist(deckA.playlist) };
  if (deckA.metadata?.id === trackId) {
    deckA.metadata = { ...deckA.metadata, ...updates };
  }
  
  deckB = { ...deckB, playlist: updatePlaylist(deckB.playlist) };
  if (deckB.metadata?.id === trackId) {
    deckB.metadata = { ...deckB.metadata, ...updates };
  }
  
  emit();
};
