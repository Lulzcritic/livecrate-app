import React, { useEffect } from 'react';
import { SearchBar } from './components/SearchBar';
import { Deck } from './components/Deck';
import { Mixer } from './components/Mixer';
import { SyncMatcher } from './components/SyncMatcher';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { useAppStore, deckA, deckB } from './store/useAppStore';
import { backgroundAnalyzer } from './audio/analysisQueue';
import { ErrorModal } from './components/ErrorModal';

import { invoke } from '@tauri-apps/api/core';

function App() {
  const store = useAppStore();

  useEffect(() => {
    // Force minimum size on start if OS cached a smaller size
    getCurrentWindow().setSize(new LogicalSize(1400, 850)).catch(console.error);
    
    // Close splashscreen once mounted (with slight delay so UI is fully rendered)
    setTimeout(() => {
      invoke('close_splashscreen').catch(console.error);
    }, 500);

    // Start background analyzer
    backgroundAnalyzer.start();

    const unlistenDl = listen<number>('stem-download-progress', (event) => {
      if (deckA.stemsStatus === 'separating') {
        store.updateDeckA({ stemsProgress: { message: 'Downloading Model...', percent: event.payload } });
      } else if (deckB.stemsStatus === 'separating') {
        store.updateDeckB({ stemsProgress: { message: 'Downloading Model...', percent: event.payload } });
      }
    });

    const unlistenSp = listen<any>('stem-split-progress', (event) => {
      const p = event.payload;
      let msg = 'Splitting...';
      let percent = 0;
      
      if (p.type === 'stage') {
        msg = `Stage: ${p.stage}`;
        percent = 0;
      } else if (p.type === 'chunks') {
        msg = `GPU Processing Chunks...`;
        percent = p.percent;
      } else if (p.type === 'writing') {
        msg = `Writing ${p.stem}...`;
        percent = p.percent;
      } else if (p.type === 'finished') {
        msg = 'Finished';
        percent = 100;
      }

      if (deckA.stemsStatus === 'separating') {
        store.updateDeckA({ stemsProgress: { message: msg, percent } });
      } else if (deckB.stemsStatus === 'separating') {
        store.updateDeckB({ stemsProgress: { message: msg, percent } });
      }
    });

    return () => {
      unlistenDl.then(f => f());
      unlistenSp.then(f => f());
      backgroundAnalyzer.stop();
    };
  }, []);
  return (
    <div className="min-h-screen flex flex-col p-6 gap-6 pt-12 relative overflow-auto min-w-[1400px]">
      <ErrorModal />
      {/* Top section: Search */}
      <div className="w-full flex justify-center shrink-0">
        <SearchBar />
      </div>

      {/* Main section: Decks + Mixer */}
      <div className="flex-1 flex gap-6 items-stretch justify-center max-w-[1600px] mx-auto w-full relative z-10">
        
        {/* Deck A */}
        <Deck id="A" />
        
        {/* Center Mixer */}
        <div className="flex flex-col justify-end shrink-0">
          <SyncMatcher />
          <Mixer />
        </div>
        
        {/* Deck B */}
        <Deck id="B" />
        
      </div>
    </div>
  );
}

export default App;
