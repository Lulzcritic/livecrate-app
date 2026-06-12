import Meyda from 'meyda';

// Krumhansl-Schmuckler key profiles
const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Camelot wheel mapping for DJs (1A to 12B)
// Minor keys (A)
const camelotMinor: Record<string, string> = {
  'Abm': '1A', 'Ebm': '2A', 'Bbm': '3A', 'Fm': '4A', 'Cm': '5A', 'Gm': '6A',
  'Dm': '7A', 'Am': '8A', 'Em': '9A', 'Bm': '10A', 'F#m': '11A', 'C#m': '12A'
};
// Major keys (B)
const camelotMajor: Record<string, string> = {
  'B': '1B', 'F#': '2B', 'Db': '3B', 'Ab': '4B', 'Eb': '5B', 'Bb': '6B',
  'F': '7B', 'C': '8B', 'G': '9B', 'D': '10B', 'A': '11B', 'E': '12B'
};

function normalizeChroma(chroma: number[]) {
  // Meyda returns 12 bins corresponding to C, C#, D...
  return chroma; // Meyda chroma is usually already scaled
}

function pearsonCorrelation(x: number[], y: number[]) {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export async function detectKey(buffer: AudioBuffer): Promise<string> {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  
  // We don't need to analyze every single sample, we can skip through the track
  // Meyda requires buffer size to be a power of 2
  const bufferSize = 4096;
  const hopSize = sampleRate; // analyze 1 window per second
  
  const totalChroma = new Array(12).fill(0);
  let windowsAnalyzed = 0;

  for (let i = 0; i < channelData.length - bufferSize; i += hopSize) {
    const window = channelData.slice(i, i + bufferSize);
    
    // Configure Meyda for this window
    Meyda.bufferSize = bufferSize;
    Meyda.sampleRate = sampleRate;
    
    try {
      const features = Meyda.extract('chroma', window) as number[];
      if (features && features.length === 12) {
        for (let j = 0; j < 12; j++) {
          totalChroma[j] += features[j];
        }
        windowsAnalyzed++;
      }
    } catch (e) {
      // Meyda might throw if signal is pure silence, ignore
    }
  }

  if (windowsAnalyzed === 0) return 'Unknown';

  // Average the chroma
  const avgChroma = totalChroma.map(c => c / windowsAnalyzed);
  
  let bestCorrelation = -1;
  let bestKey = '';
  let bestMode = '';
  let bestNoteIdx = 0;

  // Test all 12 major and 12 minor keys
  for (let i = 0; i < 12; i++) {
    // Shift profiles to match the root note
    const shiftedMajor = [...majorProfile.slice(12 - i), ...majorProfile.slice(0, 12 - i)];
    const shiftedMinor = [...minorProfile.slice(12 - i), ...minorProfile.slice(0, 12 - i)];

    const corrMajor = pearsonCorrelation(avgChroma, shiftedMajor);
    const corrMinor = pearsonCorrelation(avgChroma, shiftedMinor);

    if (corrMajor > bestCorrelation) {
      bestCorrelation = corrMajor;
      bestKey = notes[i];
      bestMode = 'Major';
      bestNoteIdx = i;
    }
    
    if (corrMinor > bestCorrelation) {
      bestCorrelation = corrMinor;
      bestKey = notes[i];
      bestMode = 'Minor';
      bestNoteIdx = i;
    }
  }

  // Format the key (e.g. "Am", "C")
  let formattedKey = bestKey;
  if (bestMode === 'Minor') {
    formattedKey += 'm';
  }

  // Optional: Convert to Camelot notation if possible
  // Normalize enharmonics to match our dictionary
  const enharmonics: Record<string, string> = {
    'C#': 'Db', 'D#': 'Eb', 'F#': 'F#', 'G#': 'Ab', 'A#': 'Bb',
    'C#m': 'C#m', 'D#m': 'Ebm', 'F#m': 'F#m', 'G#m': 'Abm', 'A#m': 'Bbm'
  };
  
  let searchKey = formattedKey;
  if (enharmonics[searchKey]) searchKey = enharmonics[searchKey];

  let camelot = camelotMajor[searchKey] || camelotMinor[searchKey];
  
  if (camelot) {
    return `${camelot} - ${formattedKey}`;
  }

  return formattedKey;
}
