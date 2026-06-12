import React from 'react';
import { useAppStore, clearError } from '../store/useAppStore';
import { AlertTriangle, X } from 'lucide-react';

export function ErrorModal() {
  const { globalError } = useAppStore();

  if (!globalError) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#111111] border border-red-900 w-full max-w-md shadow-[0_0_50px_rgba(220,38,38,0.15)] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center px-4 py-3 border-b border-[#222222] bg-red-950/20">
          <div className="flex items-center gap-2 text-red-500">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-op1 font-bold tracking-widest text-lg">SYSTEM ERROR</span>
          </div>
          <button 
            onClick={clearError}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="font-op1 font-light text-gray-300 whitespace-pre-wrap leading-relaxed text-sm">
            {globalError}
          </p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#222222] flex justify-end bg-black/20">
          <button
            onClick={clearError}
            className="px-6 py-2 bg-[#222222] hover:bg-[#333333] border border-[#444444] font-op1 font-bold tracking-widest text-sm transition-colors"
          >
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
}
