import React, { useRef, useState } from 'react';

interface FaderProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (val: number) => void;
  horizontal?: boolean;
  color?: string;
  label?: string;
  compact?: boolean;
}

export function Fader({ value, min = 0, max = 1, onChange, horizontal = false, color = '#ffffff', label, compact = false }: FaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const percent = (value - min) / (max - min);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!trackRef.current) return;
    const target = e.target as HTMLElement;
    target.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updateValue(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    updateValue(e);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    const target = e.target as HTMLElement;
    target.releasePointerCapture(e.pointerId);
  };

  const updateValue = (e: React.PointerEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    
    let newPercent = 0;
    if (horizontal) {
      newPercent = (e.clientX - rect.left) / rect.width;
    } else {
      newPercent = 1 - ((e.clientY - rect.top) / rect.height);
    }
    
    newPercent = Math.max(0, Math.min(1, newPercent));
    onChange(min + newPercent * (max - min));
  };

  const trackContainerStyle = horizontal 
    ? `relative w-full ${compact ? 'h-6' : 'h-10'} cursor-ew-resize flex items-center justify-center group`
    : "relative w-10 h-32 cursor-ns-resize flex justify-center group"; // No items-center for vertical so top-0/bottom-0 works natively

  return (
    <div className={`flex items-center ${horizontal ? (compact ? 'gap-2 flex-row w-full justify-between' : 'gap-2 flex-row') : 'gap-2 flex-col'}`}>
      {horizontal && compact && (
        <div className="flex items-baseline gap-2 w-24 shrink-0 justify-end mr-2">
          {label && <span className="text-[10px] font-op1 font-bold text-gray-400 uppercase tracking-widest">{label}</span>}
          <span className="text-lg font-op1 font-light" style={{ color }}>{Math.round(value * 100)}</span>
        </div>
      )}

      <div 
        ref={trackRef}
        className={trackContainerStyle + (horizontal && compact ? " flex-1" : "")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Track Line */}
        <div 
          className={`absolute ${horizontal ? 'left-0 right-0 h-px top-1/2 -mt-[0.5px]' : 'top-0 bottom-0 w-px left-1/2 -ml-[0.5px]'}`} 
          style={{ backgroundColor: '#666666' }} 
        />
        
        {/* Thumb wrapper */}
        <div 
          className={`absolute flex items-center justify-center`}
          style={horizontal 
            ? { left: `${percent * 100}%`, top: 0, bottom: 0, width: '2px', marginLeft: '-1px' }
            : { bottom: `${percent * 100}%`, left: 0, right: 0, height: '2px', marginBottom: '-1px' }
          }
        >
          {/* Thumb Line */}
          <div 
            className={`absolute ${horizontal ? 'top-1/4 bottom-1/4 w-px' : 'left-1/4 right-1/4 h-px'}`}
            style={{ backgroundColor: color }} 
          />
          {/* Center dot */}
          <div 
            className="w-1.5 h-1.5 rounded-full" 
            style={{ backgroundColor: color }} 
          />
        </div>
      </div>
      
      {/* Label and Value (Original position for non-compact or vertical) */}
      {(!horizontal || !compact) && (
        <div className={`flex flex-col ${horizontal ? 'items-start ml-2' : 'items-center mt-1'}`}>
          {label && <span className="text-[10px] font-op1 font-bold text-gray-400 uppercase tracking-widest">{label}</span>}
          <span className="text-xl font-op1 font-light -mt-1" style={{ color }}>{Math.round(value * 100)}</span>
        </div>
      )}
    </div>
  );
}
