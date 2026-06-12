import { useAppStore } from '../store/useAppStore';
import { isKeyCompatible } from '../audio/harmonicMixing';
import { AudioEngine } from '../audio/engine';

export function SyncMatcher() {
  const store = useAppStore();
  const engine = AudioEngine.getInstance();
  
  const bpmA = store.deckA.originalBpm !== null ? store.deckA.originalBpm * store.deckA.pitch : null;
  const bpmB = store.deckB.originalBpm !== null ? store.deckB.originalBpm * store.deckB.pitch : null;

  const isMatched = bpmA !== null && bpmB !== null && Math.abs(bpmA - bpmB) < 0.15;
  const bothLoaded = bpmA !== null && bpmB !== null;

  const keyA = store.deckA.key;
  const keyB = store.deckB.key;
  const isHarmonicMatch = bothLoaded && isKeyCompatible(keyA, keyB);

  const handleSyncA = () => {
    engine.getDeck('A').syncTo(engine.getDeck('B'));
  };

  const handleSyncB = () => {
    engine.getDeck('B').syncTo(engine.getDeck('A'));
  };

  return (
    <div className="flex items-center justify-center gap-4 w-full mb-4 px-12">
      
      {/* DECK A BPM BOX */}
      <div className="flex flex-col border border-[var(--color-op-blue)] flex-1 h-32 relative group">
        <div className="border-b border-[var(--color-op-blue)] p-1 flex justify-between items-center">
          <span className="text-xs font-op1 text-[var(--color-op-blue)]">BPM A</span>
          <span className="text-xs font-op1 text-[var(--color-op-blue)] uppercase">{keyA ? keyA.split(' ')[0] : '--'}</span>
        </div>
        <div className="flex-1 flex items-center justify-center relative">
          <span className="text-5xl font-op1 font-light tracking-tight" style={{ color: 'var(--color-op-blue)' }}>
            {bpmA ? Math.round(bpmA) : '---'}
          </span>
          <button 
            onClick={handleSyncA}
            className="absolute inset-0 w-full h-full bg-[var(--color-op-blue)]/10 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-sm"
          >
            <span className="text-xl font-op1 font-bold text-white tracking-widest uppercase">SYNC</span>
          </button>
        </div>
        <div className="border-t border-[var(--color-op-blue)] p-1 text-center">
          <span className="text-[10px] font-op1 text-white">{bpmA ? (bpmA / 60).toFixed(2) + ' BPS' : '- BPS'}</span>
        </div>
      </div>

      {/* LINK CENTER */}
      <div className="flex flex-col items-center justify-center gap-2 px-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-4 h-px bg-[var(--color-op-teal)]" />
          <span className="text-[12px] font-op1 text-[var(--color-op-teal)] tracking-widest font-bold">
            {bothLoaded ? (isMatched ? 'SYNCED' : 'LINK') : 'LINK'}
          </span>
          <div className="w-4 h-px bg-[var(--color-op-teal)]" />
        </div>
        
        <div className={`mt-2 border p-1 px-3 ${bothLoaded && isHarmonicMatch ? 'border-[var(--color-op-teal)] text-[var(--color-op-teal)]' : 'border-[#444444] text-[#444444]'}`}>
          <span className="text-[10px] font-op1 text-center block">HARMONIC<br/>MATCH</span>
        </div>
      </div>

      {/* DECK B BPM BOX */}
      <div className="flex flex-col border border-[var(--color-op-pink)] flex-1 h-32 relative group">
        <div className="border-b border-[var(--color-op-pink)] p-1 flex justify-between items-center">
          <span className="text-xs font-op1 text-[var(--color-op-pink)]">BPM B</span>
          <span className="text-xs font-op1 text-[var(--color-op-pink)] uppercase">{keyB ? keyB.split(' ')[0] : '--'}</span>
        </div>
        <div className="flex-1 flex items-center justify-center relative">
          <span className="text-5xl font-op1 font-light tracking-tight" style={{ color: 'var(--color-op-pink)' }}>
            {bpmB ? Math.round(bpmB) : '---'}
          </span>
          <button 
            onClick={handleSyncB}
            className="absolute inset-0 w-full h-full bg-[var(--color-op-pink)]/10 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-sm"
          >
            <span className="text-xl font-op1 font-bold text-white tracking-widest uppercase">SYNC</span>
          </button>
        </div>
        <div className="border-t border-[var(--color-op-pink)] p-1 text-center">
          <span className="text-[10px] font-op1 text-white">{bpmB ? (bpmB / 60).toFixed(2) + ' BPS' : '- BPS'}</span>
        </div>
      </div>
      
    </div>
  );
}
