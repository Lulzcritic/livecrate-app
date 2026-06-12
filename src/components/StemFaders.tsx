import React from 'react';
import { Fader } from './Fader';

interface StemFadersProps {
  vocals: number;
  drums: number;
  bass: number;
  other: number;
  onChange: (stem: 'vocals' | 'drums' | 'bass' | 'other', value: number) => void;
  color: string;
}

export function StemFaders({ vocals, drums, bass, other, onChange, color }: StemFadersProps) {
  return (
    <div className="flex flex-col gap-1 w-full h-full justify-center items-stretch bg-transparent">
      <Fader 
        label="VOCALS" 
        value={vocals} 
        onChange={(v) => onChange('vocals', v)} 
        color={color} 
        horizontal
        compact
      />
      <Fader 
        label="DRUMS" 
        value={drums} 
        onChange={(v) => onChange('drums', v)} 
        color={color} 
        horizontal
        compact
      />
      <Fader 
        label="BASS" 
        value={bass} 
        onChange={(v) => onChange('bass', v)} 
        color={color} 
        horizontal
        compact
      />
      <Fader 
        label="OTHER" 
        value={other} 
        onChange={(v) => onChange('other', v)} 
        color={color} 
        horizontal
        compact
      />
    </div>
  );
}
