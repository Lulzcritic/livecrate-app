import React from 'react';
import { Knob } from './Knob';

interface EQProps {
  low: number;
  mid: number;
  high: number;
  filter: number;
  onChange: (band: 'low' | 'mid' | 'high' | 'filter', value: number) => void;
  color: string;
}

export function EQ({ low, mid, high, filter, onChange, color }: EQProps) {
  return (
    <div className="flex flex-col gap-6 items-center">
      <Knob 
        label="HIGH" 
        value={high} 
        min={-24} 
        max={6} 
        onChange={(v) => onChange('high', v)} 
        color={color} 
      />
      <Knob 
        label="MID" 
        value={mid} 
        min={-24} 
        max={6} 
        onChange={(v) => onChange('mid', v)} 
        color={color} 
      />
      <Knob 
        label="LOW" 
        value={low} 
        min={-24} 
        max={6} 
        onChange={(v) => onChange('low', v)} 
        color={color} 
      />
      <div className="w-8 h-px bg-[#444444]" />
      <Knob 
        label="FILTER" 
        value={filter} 
        min={-1} 
        max={1} 
        onChange={(v) => onChange('filter', v)} 
        color={color} 
      />
    </div>
  );
}
