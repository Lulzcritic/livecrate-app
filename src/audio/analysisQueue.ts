import { invoke } from '@tauri-apps/api/core';
import { guess } from 'web-audio-beat-detector';
import { detectKey } from './keyDetector';
import { deckA, deckB, updateTrackInPlaylists } from '../store/useAppStore';

class AnalysisQueue {
  private isProcessing = false;
  private ctx: OfflineAudioContext;
  
  constructor() {
    // 1 channel, 1 sample (dummy values), we just use it for decoding
    this.ctx = new OfflineAudioContext(1, 1, 44100);
  }

  public async start() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    console.log('Background Analysis Queue started.');
    
    // We poll the playlist every few seconds for unanalyzed tracks
    while (this.isProcessing) {
      const trackToAnalyze = this.findUnanalyzedTrack();
      
      if (trackToAnalyze) {
        console.log(`Analyzing track in background: ${trackToAnalyze.title}`);
        try {
          // 1. Download audio
          const bytes: number[] = await invoke('extract_audio', { url: trackToAnalyze.url });
          const arrayBuf = new Uint8Array(bytes).buffer;
          
          // 2. Decode
          const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
          
          // 3. Analyze
          const { bpm } = await guess(audioBuf);
          const key = await detectKey(audioBuf);
          const roundedBpm = Math.round(bpm * 10) / 10;
          
          console.log(`Analyzed ${trackToAnalyze.title} -> BPM: ${roundedBpm}, Key: ${key}`);
          
          // 4. Update store
          updateTrackInPlaylists(trackToAnalyze.id, { bpm: roundedBpm, key });
          
          // 5. Trigger save (we just invoke the save command for the currently loaded playlist)
          // Wait, we don't know the name of the playlist here directly, but we can emit an event or
          // we can assume the user will save it, or we trigger an autosave if needed.
          // For now, we update the store, and the UI will reflect it.
          // We can dispatch an event so PlaylistPanel knows to save.
          window.dispatchEvent(new CustomEvent('playlist-analyzed'));
          
        } catch (e) {
          console.error(`Failed to analyze track ${trackToAnalyze.title}:`, e);
          // Mark it as failed so we don't retry forever?
          // We can set bpm to 0 to indicate it failed.
          updateTrackInPlaylists(trackToAnalyze.id, { bpm: 0 }); 
        }
      } else {
        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  public stop() {
    this.isProcessing = false;
  }

  private findUnanalyzedTrack() {
    // Check deckA playlist first
    let track = deckA.playlist.find(t => t.bpm === null);
    if (track) return track;
    
    // Then check deckB
    track = deckB.playlist.find(t => t.bpm === null);
    return track;
  }
}

export const backgroundAnalyzer = new AnalysisQueue();
