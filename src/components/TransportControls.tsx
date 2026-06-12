import React from 'react';
import { Play, Square, Pause, RotateCcw } from 'lucide-react';

interface TransportControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onCue: () => void;
  color: string;
}

export function TransportControls({ isPlaying, onPlayPause, onStop, onCue, color }: TransportControlsProps) {
  const btnClass = "flex items-center justify-center bg-transparent hover:bg-[#444444] rounded-none border border-[#444444] transition-colors text-white";

  return (
    <div className="flex flex-col gap-2 h-full">
      <button 
        className={`w-full h-12 ${btnClass} flex-1`}
        onClick={onPlayPause}
        style={isPlaying ? { borderColor: color, color: color } : {}}
      >
        {isPlaying ? <Pause size={24} /> : <Play size={24} />}
      </button>
      
      <button 
        className={`w-full h-12 ${btnClass} flex-1`}
        onClick={onCue}
      >
        <span className="font-op1 text-xl font-light tracking-widest">CUE</span>
      </button>
      
      <div className="flex gap-2">
        <button 
          className={`h-8 flex-1 ${btnClass}`}
          onClick={onStop}
        >
          <Square size={14} />
        </button>

        <button 
          className={`h-8 flex-1 ${btnClass}`}
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  );
}
