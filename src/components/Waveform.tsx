import React, { useRef, useEffect } from 'react';

// Using any to avoid circular type imports for the PoC
interface WaveformProps {
  deckEngine: any; 
  color: string;
  originalBpm?: number | null;
}

export function Waveform({ deckEngine, color, originalBpm }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>();
  
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartTime = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !deckEngine.isLoaded()) return;
    
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartTime.current = deckEngine.getCurrentTime();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    
    const deltaX = e.clientX - dragStartX.current;
    
    // We need to know how many seconds 1 pixel represents
    // totalWaveformWidth = numPoints * PIXELS_PER_POINT * ZOOM_FACTOR
    // duration = totalWaveformWidth in pixels
    const duration = deckEngine.getDuration() || 1;
    const numPoints = 8000; // Hardcoded in extractPeaks
    const PIXELS_PER_POINT = 2;
    const ZOOM_FACTOR = 0.5;
    const totalWaveformWidth = numPoints * PIXELS_PER_POINT * ZOOM_FACTOR;
    
    const secPerPixel = duration / totalWaveformWidth;
    
    // Moving mouse right means moving waveform right -> playhead goes left (backwards)
    const newTime = dragStartTime.current - (deltaX * secPerPixel);
    
    deckEngine.seek(newTime);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Configuration
    const PIXELS_PER_POINT = 2; 
    const ZOOM_FACTOR = 0.5; 

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);

      const width = canvas.width;
      const height = canvas.height;
      const halfHeight = height / 2;

      // Clear canvas
      ctx.fillStyle = 'rgba(10, 10, 15, 1.0)'; // opaque to avoid trailing
      ctx.fillRect(0, 0, width, height);

      const peaks = deckEngine.getPeaks();
      const isLoaded = deckEngine.isLoaded();
      
      if (!isLoaded || !peaks) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;
        ctx.beginPath();
        ctx.moveTo(0, halfHeight);
        ctx.lineTo(width, halfHeight);
        ctx.stroke();
        
        if (isLoaded && !peaks) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = color;
          ctx.font = '14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText("ANALYZING WAVEFORM...", width / 2, halfHeight - 20);
        }
        return;
      }

      const duration = deckEngine.getDuration() || 1;
      const currentTime = deckEngine.getCurrentTime();
      const progress = currentTime / duration;
      
      const numPoints = peaks.length / 2;
      const totalWaveformWidth = numPoints * PIXELS_PER_POINT * ZOOM_FACTOR;
      const secPerPixel = duration / totalWaveformWidth;
      const playheadOffset = progress * totalWaveformWidth;
      const startX = (width / 2) - playheadOffset;

      // Draw Beatgrids
      if (originalBpm) {
        const beatIntervalSec = 60 / originalBpm;
        const totalBeats = Math.floor(duration / beatIntervalSec);
        
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; // Faint white lines
        ctx.shadowBlur = 0;
        ctx.beginPath();
        
        for (let i = 0; i <= totalBeats; i++) {
          const beatTime = i * beatIntervalSec;
          const beatX = startX + (beatTime / secPerPixel);
          
          if (beatX >= 0 && beatX <= width) {
            ctx.moveTo(beatX, 0);
            ctx.lineTo(beatX, height);
            
            // Mark every 4th beat slightly brighter (downbeat)
            if (i % 4 === 0) {
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
              ctx.stroke();
              ctx.beginPath();
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            }
          }
        }
        ctx.stroke();
      }

      ctx.lineWidth = PIXELS_PER_POINT;
      ctx.strokeStyle = color;
      ctx.beginPath();

      for (let i = 0; i < numPoints; i++) {
        const x = startX + (i * PIXELS_PER_POINT * ZOOM_FACTOR);
        if (x < -PIXELS_PER_POINT || x > width + PIXELS_PER_POINT) continue;

        const min = peaks[i * 2];
        const max = peaks[i * 2 + 1];
        
        const yTop = (1 - max) * halfHeight;
        const yBottom = (1 - min) * halfHeight;

        ctx.moveTo(x, yTop);
        ctx.lineTo(x, yBottom);
      }
      ctx.stroke();
    };

    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [deckEngine, color, originalBpm]);

  return (
    <div className="w-full h-32 bg-transparent overflow-hidden relative cursor-ew-resize">
      <canvas 
        ref={canvasRef} 
        width={800} 
        height={128} 
        className="w-full h-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white z-10 pointer-events-none" />
    </div>
  );
}
