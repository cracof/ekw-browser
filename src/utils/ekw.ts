/**
 * Calculates the check digit for a Polish Land and Mortgage Register (EKW) number.
 * Format: [Prefix]/[Number]/[CheckDigit]
 * Example: KR1P/00012345/1
 */
export function calculateCheckDigit(prefix: string, number: string): number {
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
  const fullString = (prefix.padEnd(4, ' ') + number.padStart(8, '0')).toUpperCase();
  
  const charToValue = (char: string): number => {
    if (/[0-9]/.test(char)) return parseInt(char, 10);
    if (char === ' ') return 0;
    // A=10, B=11, ..., Z=35
    // But EKW uses a specific mapping for letters
    const mapping: { [key: string]: number } = {
      '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
      'X': 10, 'A': 11, 'B': 12, 'C': 13, 'D': 14, 'E': 15, 'F': 16, 'G': 17, 'H': 18,
      'I': 19, 'J': 20, 'K': 21, 'L': 22, 'M': 23, 'N': 24, 'O': 25, 'P': 26, 'R': 27,
      'S': 28, 'T': 29, 'U': 30, 'W': 31, 'Y': 32, 'Z': 33
    };
    return mapping[char] ?? 0;
  };

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += charToValue(fullString[i]) * weights[i];
  }

  return sum % 10;
}

export function formatEkwNumber(prefix: string, number: string | number): string {
  const numStr = number.toString().padStart(8, '0');
  const cd = calculateCheckDigit(prefix, numStr);
  return `${prefix}/${numStr}/${cd}`;
}
