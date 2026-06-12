import React, { useRef, useState } from 'react';

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Knob({ label, value, min, max, onChange, color = '#ffffff', size = 'md' }: KnobProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startVal = useRef(0);

  const percent = (value - min) / (max - min);
  const angle = percent * 270 - 135;

  const sizeClass = size === 'sm' ? 'w-10 h-10' : size === 'lg' ? 'w-20 h-20' : 'w-12 h-12';

  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    target.setPointerCapture(e.pointerId);
    setIsDragging(true);
    startY.current = e.clientY;
    startVal.current = value;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    
    const deltaY = startY.current - e.clientY;
    const range = max - min;
    const deltaVal = (deltaY / 100) * range;
    
    let newVal = startVal.current + deltaVal;
    newVal = Math.max(min, Math.min(max, newVal));
    onChange(newVal);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    const target = e.target as HTMLElement;
    target.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div 
        className={`relative rounded-full border cursor-ns-resize flex items-center justify-center ${sizeClass}`}
        style={{ borderColor: color }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Needle */}
        <div 
          className="absolute top-1/2 left-1/2 origin-top w-[2px] rounded-full"
          style={{ height: '50%', backgroundColor: color, transform: `translateX(-50%) rotate(${angle + 180}deg)` }}
        />
        {/* Center dot */}
        <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2" style={{ backgroundColor: color }} />
      </div>

      <div className="flex flex-col items-center">
        <span className="text-[10px] font-op1 text-gray-500 uppercase tracking-widest">{label}</span>
      </div>
    </div>
  );
}
