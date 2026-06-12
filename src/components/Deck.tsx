import React from 'react';
import { Waveform } from './Waveform';
import { TransportControls } from './TransportControls';
import { StemFaders } from './StemFaders';
import { useAppStore } from '../store/useAppStore';
import { AudioEngine } from '../audio/engine';
import { separateStems, getStemData, checkStemModel, downloadStemModel } from '../api/tauri';
import { Loader2, Wand2, DownloadCloud } from 'lucide-react';
import { PlaylistPanel } from './PlaylistPanel';
import { listen } from '@tauri-apps/api/event';

interface DeckProps {
  id: 'A' | 'B';
}

export function Deck({ id }: DeckProps) {
  const store = useAppStore();
  const state = id === 'A' ? store.deckA : store.deckB;
  const updateState = id === 'A' ? store.updateDeckA : store.updateDeckB;
  
  const engine = AudioEngine.getInstance().getDeck(id);
  
  const color = id === 'A' ? '#FF6B00' : '#00A3FF';

  const [showModelModal, setShowModelModal] = React.useState(false);
  const [downloadProgress, setDownloadProgress] = React.useState<number | null>(null);

  React.useEffect(() => {
    const unlisten = listen('model-download-progress', (event) => {
      const payload = event.payload as { downloaded: number, total: number };
      if (payload.total > 0) {
        setDownloadProgress((payload.downloaded / payload.total) * 100);
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const handlePlayPause = () => {
    if (state.playing) {
      engine.pause();
      updateState({ playing: false });
    } else {
      engine.play();
      updateState({ playing: true });
    }
  };

  const handleStop = () => {
    engine.stop();
    updateState({ playing: false });
  };

  const handleStemVolumeChange = (type: keyof typeof state.stemVolumes, val: number) => {
    updateState({
      stemVolumes: { ...state.stemVolumes, [type]: val }
    });
    engine.setStemVolume(type, val);
  };

  const handleSeparateStems = async () => {
    if (!state.loaded || state.stemsStatus !== 'none') return;
    
    // Check if model exists
    const hasModel = await checkStemModel();
    if (!hasModel) {
      setShowModelModal(true);
      return;
    }

    startStemSeparation();
  };

  const startStemSeparation = async () => {
    updateState({ stemsStatus: 'separating' });
    try {
      console.log(`Requesting stem separation for Deck ${id}...`);
      await separateStems(id);
      
      console.log('Fetching stem buffers...');
      const [vocals, drums, bass, other] = await Promise.all([
        getStemData(id, 'vocals'),
        getStemData(id, 'drums'),
        getStemData(id, 'bass'),
        getStemData(id, 'other'),
      ]);
      
      console.log('Loading stems into AudioEngine...');
      await engine.loadStems(vocals, drums, bass, other);
      
      updateState({ stemsStatus: 'ready' });
      console.log(`Deck ${id} stems ready!`);
    } catch (error) {
      console.error(`Failed to separate stems for Deck ${id}:`, error);
      updateState({ stemsStatus: 'none' });
      import('../store/useAppStore').then(m => m.showError('Stem separation failed: ' + error));
    }
  };

  const handleDownloadModel = async () => {
    setDownloadProgress(0);
    try {
      await downloadStemModel();
      setShowModelModal(false);
      startStemSeparation();
    } catch (error) {
      console.error('Failed to download stem model:', error);
      alert('Error downloading model: ' + error);
      setShowModelModal(false);
      setDownloadProgress(null);
    }
  };

  const liveBpm = state.originalBpm !== null ? state.originalBpm * state.pitch : null;

  return (
    <div className={`flex flex-col gap-4 flex-1 min-w-0 bg-transparent`}>
      {/* Header Info */}
      <div className="flex flex-col border" style={{ borderColor: color }}>
        <div className="flex justify-between items-end border-b p-2" style={{ borderColor: color }}>
          <div className="flex-1 min-w-0">
            <h2 className="text-3xl font-op1 font-light truncate tracking-wide" style={{ color }}>
              {state.isLoading ? state.statusText : (state.metadata ? state.metadata.title : `DECK ${id}`)}
            </h2>
            <p className="text-lg font-op1 font-bold text-gray-400 truncate uppercase tracking-widest mt-1">
              {state.metadata ? state.metadata.artist : (state.isLoading ? "LOADING..." : "INSERT TRACK")}
            </p>
          </div>
          <div className="flex gap-8 font-op1 text-4xl shrink-0">
            <div className="flex items-end gap-2">
              <span className="text-sm font-bold tracking-widest mb-1" style={{ color }}>BPM</span>
              <span className="font-light">{liveBpm !== null ? liveBpm.toFixed(1) : "---.-"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Waveform */}
      <div className="border border-[#444444]">
        <Waveform 
          deckEngine={engine}
          color={color}
          originalBpm={state.originalBpm}
        />
      </div>

      {/* Controls Row */}
      <div className="flex justify-between items-stretch gap-4">
        
        {/* Left: Transport & Stems */}
        <div className="flex gap-4 flex-1 h-32">
          <TransportControls 
            isPlaying={state.playing}
            onPlayPause={handlePlayPause}
            onStop={handleStop}
            onCue={handleStop}
            color={color}
          />
          
          <div className="flex-1 flex flex-col justify-center items-center border border-[#444444] px-4 py-2 relative">
            {state.stemsStatus === 'ready' ? (
              <StemFaders 
                vocals={state.stemVolumes.vocals}
                drums={state.stemVolumes.drums}
                bass={state.stemVolumes.bass}
                other={state.stemVolumes.other}
                onChange={handleStemVolumeChange}
                color={color}
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                {state.stemsStatus === 'separating' ? (
                  <div className="flex flex-col items-center gap-2 w-full">
                    <Loader2 className="w-6 h-6 animate-spin" style={{ color }} />
                    <span className="text-xs font-op1 tracking-widest uppercase">
                      {state.stemsProgress?.message || 'Processing...'}
                    </span>
                    {state.stemsProgress && (
                      <div className="w-full border border-[#444444] h-1.5 mt-2">
                        <div 
                          className="h-full"
                          style={{ width: `${state.stemsProgress.percent}%`, backgroundColor: color }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <button 
                    onClick={handleSeparateStems}
                    disabled={!state.loaded}
                    className="flex flex-col items-center gap-2 text-[#444444] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <Wand2 className="w-6 h-6 group-hover:text-[var(--color-op-teal)] transition-colors" />
                    <span className="font-op1 text-[10px] uppercase tracking-widest font-bold">Extract Stems</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Playlist Panel */}
      <PlaylistPanel id={id} engine={engine} color={color} />

      {/* Model Download Modal */}
      {showModelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111111] border border-[#333333] p-8 max-w-md w-full shadow-2xl flex flex-col gap-6">
            <div className="flex items-center gap-4 text-white">
              <DownloadCloud className="w-8 h-8" style={{ color }} />
              <h2 className="text-xl font-op1 tracking-widest uppercase font-bold">AI Model Required</h2>
            </div>
            
            <p className="text-sm text-gray-400 font-mono leading-relaxed">
              Stem separation uses an Artificial Intelligence that requires a ~150 MB model.
              Do you want to download it now? This is only required once.
            </p>

            {downloadProgress !== null && (
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs font-op1 tracking-widest text-gray-400">
                  <span>DOWNLOADING...</span>
                  <span>{downloadProgress.toFixed(1)}%</span>
                </div>
                <div className="w-full h-2 bg-black border border-[#333333]">
                  <div 
                    className="h-full transition-all duration-300"
                    style={{ width: `${downloadProgress}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            )}

            {downloadProgress === null && (
              <div className="flex justify-end gap-4 mt-2">
                <button 
                  onClick={() => setShowModelModal(false)}
                  className="px-6 py-2 font-op1 tracking-widest text-xs uppercase text-gray-400 hover:text-white border border-[#333333] hover:border-white transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDownloadModel}
                  className="px-6 py-2 font-op1 tracking-widest text-xs uppercase font-bold text-black transition-colors"
                  style={{ backgroundColor: color }}
                >
                  Download
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
