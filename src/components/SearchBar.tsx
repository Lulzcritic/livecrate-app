import React, { useState, useEffect } from 'react';
import { Search, Loader2, Plus, ListPlus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore, updateDeckState, Track, getActiveKey, isKeyCompatible } from '../store/useAppStore';

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const store = useAppStore();
  const activeKey = getActiveKey(store);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const { processTrack } = await import('../store/useAppStore');
      if (query.includes('playlist?list=')) {
        const rawTracks = await invoke<Track[]>('get_youtube_playlist', { url: query });
        setResults(rawTracks.map(processTrack));
      } else {
        const rawTracks = await invoke<Track[]>('search_youtube', { query });
        setResults(rawTracks.map(processTrack));
      }
    } catch (err: any) {
      console.error(err);
      setError(err.toString());
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    // Auto-search after typing (debounce)
    const timer = setTimeout(() => {
      handleSearch();
    }, 1000);
    return () => clearTimeout(timer);
  }, [query]);

  const handleAddToDeck = (deckId: 'A' | 'B', tracks: Track[]) => {
    const deck = deckId === 'A' ? store.deckA : store.deckB;
    const newPlaylist = [...deck.playlist, ...tracks];
    updateDeckState(deckId, { playlist: newPlaylist });
    
    // Clear search after adding single track
    if (tracks.length === 1) {
      setQuery('');
      setResults([]);
    }
  };

  const handleAddAllToDeck = (deckId: 'A' | 'B') => {
    handleAddToDeck(deckId, results);
    setQuery('');
    setResults([]);
  };

  return (
    <div className="relative w-full max-w-2xl">
      <form onSubmit={handleSearch} className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-gray-500" />
        </div>
        <input
          type="text"
          className="block w-full pl-11 pr-12 py-3 bg-[#111111] border border-[#444444] rounded-full text-white placeholder-gray-500 focus:outline-none focus:border-gray-300 focus:bg-transparent transition-all shadow-none font-op1"
          placeholder="Search for a track, or paste a YouTube Playlist URL..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {isSearching && (
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
            <Loader2 className="h-4 w-4 text-gray-500 animate-spin" />
          </div>
        )}
      </form>

      {error && (
        <div className="absolute top-full left-0 right-0 mt-2 p-3 bg-red-900/50 border border-red-500 text-red-200 rounded text-sm z-50">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#111111] border border-[#444444] shadow-none z-50 max-h-96 overflow-y-auto custom-scrollbar flex flex-col">
          {query.includes('playlist?list=') && (
            <div className="p-3 border-b border-[#444444] flex justify-between items-center bg-[#111111] sticky top-0 z-10">
              <span className="text-[10px] font-op1 uppercase tracking-widest text-gray-300">Playlist ({results.length} tracks)</span>
              <div className="flex gap-2">
                <button onClick={() => handleAddAllToDeck('A')} className="text-[10px] font-op1 uppercase tracking-widest text-[var(--color-op-blue)] hover:text-white px-2 py-1 flex items-center gap-1 transition-colors border border-[var(--color-op-blue)]">
                  <ListPlus className="w-3 h-3" /> ADD ALL DECK A
                </button>
                <button onClick={() => handleAddAllToDeck('B')} className="text-[10px] font-op1 uppercase tracking-widest text-[var(--color-op-pink)] hover:text-white px-2 py-1 flex items-center gap-1 transition-colors border border-[var(--color-op-pink)]">
                  <ListPlus className="w-3 h-3" /> ADD ALL DECK B
                </button>
              </div>
            </div>
          )}
          
          <ul className="flex-1">
            {results.map((track) => {
              const comp = isKeyCompatible(track.key, activeKey);
              return (
                <li key={track.id} className="flex items-center gap-4 p-3 hover:bg-[#444444]/30 border-b border-[#444444] transition-colors group">
                  <div className="relative w-16 h-12 shrink-0 overflow-hidden border border-[#444444]">
                    <img src={track.thumbnailUrl || (track as any).thumbnail_url} alt={track.title} className="w-full h-full object-cover opacity-80" />
                  </div>
                  
                  <div className="flex flex-col flex-1 min-w-0">
                    <h4 className="text-sm font-bold font-op1 tracking-widest text-gray-100 truncate group-hover:text-white transition-colors">{track.title}</h4>
                    <div className="flex items-center gap-2 text-[10px] font-op1 uppercase tracking-widest text-gray-500 mt-0.5">
                      <span className="truncate">{track.artist}</span>
                      <span>•</span>
                      <span>{Math.floor((track.durationSecs || (track as any).duration_secs) / 60)}:{(Math.floor(track.durationSecs || (track as any).duration_secs) % 60).toString().padStart(2, '0')}</span>
                      {track.bpm && (
                        <>
                          <span>•</span>
                          <span>{track.bpm} BPM</span>
                        </>
                      )}
                      {track.key && (
                        <>
                          <span>•</span>
                          <span className={comp ? "text-[#00e5b5] font-bold" : ""}>{track.key}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => handleAddToDeck('A', [track])}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-none border border-[var(--color-op-blue)] text-[var(--color-op-blue)] hover:bg-[var(--color-op-blue)] hover:text-black transition-all text-[10px] font-op1 font-bold tracking-widest"
                    >
                      <Plus className="w-3 h-3" /> A
                    </button>
                    <button 
                      onClick={() => handleAddToDeck('B', [track])}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-none border border-[var(--color-op-pink)] text-[var(--color-op-pink)] hover:bg-[var(--color-op-pink)] hover:text-black transition-all text-[10px] font-op1 font-bold tracking-widest"
                    >
                      <Plus className="w-3 h-3" /> B
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
