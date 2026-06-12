/**
 * Helper utility to determine key compatibility based on the Camelot Wheel.
 */

interface ParsedKey {
  hour: number;
  mode: 'A' | 'B';
}

export function parseCamelotKey(keyStr: string | null): ParsedKey | null {
  if (!keyStr) return null;
  // Key string format example: "8A - Am" or just "8A"
  const match = keyStr.match(/^(\d{1,2})([AB])/i);
  if (match) {
    return {
      hour: parseInt(match[1], 10),
      mode: match[2].toUpperCase() as 'A' | 'B'
    };
  }
  return null;
}

export function isKeyCompatible(keyStr1: string | null, keyStr2: string | null): boolean {
  const k1 = parseCamelotKey(keyStr1);
  const k2 = parseCamelotKey(keyStr2);

  if (!k1 || !k2) return false;

  // Rule 1: Exact match
  if (k1.hour === k2.hour && k1.mode === k2.mode) return true;

  // Rule 2: Change mode at same hour (e.g. 8A to 8B)
  if (k1.hour === k2.hour && k1.mode !== k2.mode) return true;

  // Rule 3: Move +/- 1 hour in same mode (e.g. 8A to 7A or 9A)
  if (k1.mode === k2.mode) {
    const diff = Math.abs(k1.hour - k2.hour);
    // Remember the wheel wraps around: 1 and 12 are adjacent
    if (diff === 1 || diff === 11) return true;
  }

  // Energy boost / diagonal mixes are considered advanced and usually not marked as "perfectly compatible"
  // For standard harmonic mixing, we stick to the rules above.
  return false;
}
