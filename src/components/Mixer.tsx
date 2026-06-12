import React from 'react';
import { Fader } from './Fader';
import { EQ } from './EQ';
import { useAppStore, updateDeckState } from '../store/useAppStore';
import { AudioEngine } from '../audio/engine';

export function Mixer() {
  const store = useAppStore();
  const engine = AudioEngine.getInstance();

  const handleCrossfader = (val: number) => {
    store.setCrossfader(val);
    engine.setCrossfader(val);
  };

  const handleVolA = (val: number) => {
    store.updateDeckA({ volume: val });
    engine.getDeck('A').setVolume(val);
  };

  const handleVolB = (val: number) => {
    store.updateDeckB({ volume: val });
    engine.getDeck('B').setVolume(val);
  };

  const handleEQChange = (id: 'A' | 'B', band: 'low' | 'mid' | 'high' | 'filter', val: number) => {
    const deckEngine = engine.getDeck(id);
    const state = id === 'A' ? store.deckA : store.deckB;
    if (band === 'filter') {
      deckEngine.setFilter(val);
      updateDeckState(id, { filter: val });
    } else {
      deckEngine.setEQ(band, val);
      updateDeckState(id, { eq: { ...state.eq, [band]: val } });
    }
  };

  const handlePitchChange = (id: 'A' | 'B', val: number) => {
    updateDeckState(id, { pitch: val });
    engine.getDeck(id).setPitch(val);
  };

  const handleKeyLockToggle = (id: 'A' | 'B') => {
    const state = id === 'A' ? store.deckA : store.deckB;
    const newVal = !state.keyLock;
    updateDeckState(id, { keyLock: newVal });
    engine.getDeck(id).setKeyLock(newVal);
  };

  const handleSync = (id: 'A' | 'B') => {
    const currentState = id === 'A' ? store.deckA : store.deckB;
    const otherState = id === 'A' ? store.deckB : store.deckA;
    if (!otherState.originalBpm || !currentState.originalBpm) return;
    
    // Calculate target pitch to match the other deck's Live BPM
    const otherLiveBpm = otherState.originalBpm * otherState.pitch;
    const targetPitch = otherLiveBpm / currentState.originalBpm;
    
    handlePitchChange(id, targetPitch);
  };

  const renderPitchControls = (id: 'A' | 'B', color: string) => {
    const state = id === 'A' ? store.deckA : store.deckB;
    return (
      <div className="flex flex-col items-center gap-4 w-24">
        <div className="flex flex-col gap-1 w-full border border-[#444444] p-1">
          <button
            onClick={() => handleSync(id)}
            className="text-[10px] font-op1 tracking-widest py-1 border border-transparent hover:border-white transition-colors uppercase"
            style={{ color: '#00E5B5' }}
            title="Auto-Sync BPM"
          >
            SYNC
          </button>
          <div className="flex w-full">
            <button
              onClick={() => handleKeyLockToggle(id)}
              className={`text-[9px] font-op1 py-0.5 flex-1 border ${state.keyLock ? 'border-[#00E5B5] text-[#00E5B5]' : 'border-transparent text-gray-500 hover:border-gray-500'}`}
              title="Key Lock"
            >
              MT
            </button>
            <button
              onClick={() => handlePitchChange(id, 1.0)}
              className="text-[9px] font-op1 py-0.5 flex-1 border border-transparent text-gray-500 hover:border-gray-500"
              title="Reset Pitch"
            >
              0%
            </button>
          </div>
        </div>
        
        <div className="flex-1 py-2 w-full flex justify-center h-40">
          <Fader
            value={state.pitch}
            min={0.84}
            max={1.16}
            onChange={(val) => handlePitchChange(id, val)}
            color={color}
            label="PITCH"
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-8 border border-[#444444] p-6 bg-transparent mx-auto shrink-0 min-w-[800px]">
      
      {/* TOP ROW: PITCH, EQ, VOLUMES */}
      <div className="flex justify-between items-stretch">
        
        {/* DECK A PITCH & EQ */}
        <div className="flex gap-8 px-8 border-r border-[#444444]">
          {renderPitchControls('A', 'var(--color-op-blue)')}
          <EQ 
            color="var(--color-op-blue)" 
            low={store.deckA.eq.low}
            mid={store.deckA.eq.mid}
            high={store.deckA.eq.high}
            filter={store.deckA.filter}
            onChange={(band, val) => handleEQChange('A', band, val)}
          />
        </div>

        {/* VOLUMES CENTER */}
        <div className="flex justify-center gap-16 px-8 items-end pb-4 flex-1">
          <Fader
            value={store.deckA.volume}
            onChange={handleVolA}
            color="var(--color-op-blue)"
            label="VOL A"
          />
          <Fader
            value={store.deckB.volume}
            onChange={handleVolB}
            color="var(--color-op-pink)"
            label="VOL B"
          />
        </div>

        {/* DECK B EQ & PITCH */}
        <div className="flex gap-8 px-8 border-l border-[#444444]">
          <EQ 
            color="var(--color-op-pink)" 
            low={store.deckB.eq.low}
            mid={store.deckB.eq.mid}
            high={store.deckB.eq.high}
            filter={store.deckB.filter}
            onChange={(band, val) => handleEQChange('B', band, val)}
          />
          {renderPitchControls('B', 'var(--color-op-pink)')}
        </div>
      </div>

      {/* BOTTOM ROW: CROSSFADER */}
      <div className="px-16 pb-4 border-t border-[#444444] pt-8">
        <Fader
          value={store.crossfader}
          onChange={handleCrossfader}
          horizontal
          color="var(--color-op-white)"
          label="CROSSFADE"
        />
      </div>

    </div>
  );
}
