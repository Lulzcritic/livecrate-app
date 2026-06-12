import { useState, useEffect } from 'react';
import { useAppStore, updateDeckState, Track, getActiveKey, isKeyCompatible } from '../store/useAppStore';
import { invoke } from '@tauri-apps/api/core';
import { Play, Trash2, ListMusic, Save, Download } from 'lucide-react';
import { DeckChain } from '../audio/engine';

interface PlaylistPanelProps {
  id: 'A' | 'B';
  engine: DeckChain;
  color: string;
}

export function PlaylistPanel({ id, engine, color }: PlaylistPanelProps) {
  const store = useAppStore();
  const state = id === 'A' ? store.deckA : store.deckB;
  
  const [isExpanded, setIsExpanded] = useState(false);
  const [savedPlaylists, setSavedPlaylists] = useState<string[]>([]);
  
  useEffect(() => {
    if (isExpanded) {
      loadPlaylistsList();
    }
  }, [isExpanded]);

  const loadPlaylistsList = async () => {
    try {
      const lists = await invoke<string[]>('list_playlists');
      setSavedPlaylists(lists);
    } catch (e) {
      console.error("Failed to load playlists", e);
    }
  };

  const handlePlayTrack = async (track: Track, index: number) => {
    // Update store
    updateDeckState(id, {
      isLoading: true,
      statusText: 'Starting download...',
      metadata: track,
      currentTrackIndex: index,
      stemsStatus: 'none',
      stemsProgress: undefined,
    });
    
    try {
      await invoke('load_track', { url: track.url, deckId: id });
      
      updateDeckState(id, { statusText: 'Fetching audio data...' });
      const bytes = await invoke<number[]>('load_track_raw', { deckId: id });
      const buffer = new Uint8Array(bytes);
      
      updateDeckState(id, { statusText: 'Analyzing waveform...' });
      await engine.loadFromBytes(buffer.buffer);
      updateDeckState(id, { isLoading: false, loaded: true, playing: true });
      engine.play();
    } catch (err: any) {
      const errMsg = String(err);
      let friendlyError = 'Error loading track';
      if (errMsg.includes('Video unavailable') || errMsg.includes('not available')) {
        friendlyError = 'Track is no longer available on YouTube (deleted or private).';
      }
      updateDeckState(id, { isLoading: false, statusText: friendlyError });
      console.error(err);
      
      import('../store/useAppStore').then(m => m.showError(friendlyError));
    }
  };

  const handleRemoveTrack = (index: number) => {
    const newList = [...state.playlist];
    newList.splice(index, 1);
    updateDeckState(id, { playlist: newList });
  };

  const handleSavePlaylist = async () => {
    try {
      const name = prompt("Enter playlist name:");
      if (!name) return;
      await invoke('save_playlist', { name, tracks: state.playlist });
      updateDeckState(id, { playlistName: name });
      loadPlaylistsList();
    } catch (e) {
      import('../store/useAppStore').then(m => m.showError("Error saving: " + e));
    }
  };

  const handleLoadPlaylist = async (name: string) => {
    try {
      const rawTracks: Track[] = await invoke('load_playlist', { name });
      const { processTrack } = await import('../store/useAppStore');
      const tracks = rawTracks.map(processTrack);
      updateDeckState(id, { playlist: tracks, currentTrackIndex: -1, playlistName: name });
      setIsExpanded(true);
    } catch (e) {
      import('../store/useAppStore').then(m => m.showError("Error loading: " + e));
    }
  };

  // Auto-save when background analysis finishes
  useEffect(() => {
    const onAnalyzed = async () => {
      // Because this is a React hook with stale closure issues, we should read from the latest store state
      // Actually `state.playlistName` and `state.playlist` are from the reactive store, 
      // but inside the event listener we need the latest. 
      // A better way is to read directly from `useAppStore.getState()` if we were using Zustand,
      // but our custom store doesn't have a `.getState()`.
      // The event listener will just use the current `state` from closure if we add it to deps.
    };
    
    // Quick trick: we just add state as a dependency and use it directly,
    // or we can just fetch the store directly via the exported `deckA` / `deckB`.
    const handleAnalyzed = async () => {
      const { deckA, deckB } = await import('../store/useAppStore');
      const latestState = id === 'A' ? deckA : deckB;
      if (latestState.playlistName) {
        try {
          await invoke('save_playlist', { name: latestState.playlistName, tracks: latestState.playlist });
        } catch (e) {
          console.error('Auto-save failed:', e);
        }
      }
    };

    window.addEventListener('playlist-analyzed', handleAnalyzed);
    return () => window.removeEventListener('playlist-analyzed', handleAnalyzed);
  }, [id]);

  return (
    <div className="flex flex-col border border-[#444444] bg-transparent mt-2">
      <div 
        className="flex justify-between items-center px-4 py-2 cursor-pointer hover:bg-[#444444] transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <ListMusic className="w-4 h-4 text-gray-400" />
          <span className="font-op1 text-lg tracking-widest uppercase font-light" style={{ color }}>PLAYLIST ({state.playlist.length})</span>
        </div>
        <span className="text-[10px] text-gray-500 font-op1 uppercase tracking-widest">
          {isExpanded ? 'HIDE' : 'SHOW'}
        </span>
      </div>

      {isExpanded && (
        <div className="flex flex-col border-t border-[#444444]">
          <div className="flex justify-between items-center px-2 py-1 border-b border-[#444444]">
            <div className="flex gap-2 font-op1 uppercase tracking-widest">
              <button onClick={handleSavePlaylist} className="text-[10px] flex items-center gap-1 text-gray-400 hover:text-white px-2 py-1">
                <Save className="w-3 h-3" /> SAVE
              </button>
              <div className="relative group">
                <button className="text-[10px] flex items-center gap-1 text-gray-400 hover:text-white px-2 py-1">
                  <Download className="w-3 h-3" /> LOAD
                </button>
                <div className="absolute top-full left-0 mt-1 hidden group-hover:flex flex-col border border-[#444444] bg-[#000] min-w-[120px] z-50">
                  {savedPlaylists.map(pl => (
                    <button 
                      key={pl}
                      onClick={() => handleLoadPlaylist(pl)}
                      className="text-[10px] text-left px-3 py-2 hover:bg-[#444444] text-gray-300 hover:text-white"
                    >
                      {pl}
                    </button>
                  ))}
                  {savedPlaylists.length === 0 && (
                    <div className="text-[10px] px-3 py-2 text-gray-600">NO SAVED</div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2 font-op1 uppercase tracking-widest">
              <button 
                onClick={() => updateDeckState(id, { playlist: [], currentTrackIndex: -1 })}
                className="text-[10px] text-gray-500 hover:text-white px-2 py-1"
              >
                CLEAR ALL
              </button>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto custom-scrollbar">
            {state.playlist.length === 0 ? (
              <div className="p-4 text-center text-sm text-[#444444] font-op1 tracking-widest">
                PLAYLIST IS EMPTY
              </div>
            ) : (
              <ul className="flex flex-col">
                {state.playlist.map((track, idx) => {
                  const isCurrent = state.currentTrackIndex === idx;
                  return (
                    <li 
                      key={`${track.id}-${idx}`} 
                      className={`flex items-center justify-between p-2 hover:bg-[#444444]/30 border-b border-[#444444] transition-colors ${isCurrent ? 'bg-[#444444]/50' : ''}`}
                    >
                      <div className="flex items-center gap-3 overflow-hidden flex-1 cursor-pointer" onClick={() => handlePlayTrack(track, idx)}>
                        <div className="relative group w-10 h-10 shrink-0 overflow-hidden border border-[#444444]">
                          <img src={track.thumbnailUrl} alt={track.title} className="w-full h-full object-cover opacity-80" />
                          <div className={`absolute inset-0 bg-black/50 flex items-center justify-center ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                            <Play className="w-4 h-4 text-white ml-0.5" />
                          </div>
                        </div>
                        <div className="flex flex-col overflow-hidden">
                          <span className={`text-sm truncate font-op1 font-bold tracking-widest ${isCurrent ? '' : 'text-gray-300'}`} style={isCurrent ? { color } : {}}>
                            {track.title}
                          </span>
                          <span className="text-xs text-gray-500 font-op1 uppercase truncate tracking-widest">
                            {track.artist}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3 shrink-0 ml-2">
                        <div className="flex items-center gap-2 text-[10px] text-gray-500 font-op1 tracking-widest">
                          {track.bpm && <span>{track.bpm} BPM</span>}
                          {track.key && (
                            <span className={isKeyCompatible(track.key, getActiveKey(store)) ? "text-[#00e5b5] font-bold" : ""}>
                              {track.key}
                            </span>
                          )}
                          <span>
                            {Math.floor(track.durationSecs / 60)}:{(Math.floor(track.durationSecs) % 60).toString().padStart(2, '0')}
                          </span>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleRemoveTrack(idx); }}
                          className="text-gray-600 hover:text-red-500 p-1 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
