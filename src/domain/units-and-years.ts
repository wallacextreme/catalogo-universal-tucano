import { YearRange } from './types';

/**
 * Conversor de Pressão para padrão automotivo kPa:
 * - 1 Bar = 100 kPa
 * - 1 PSI = 6.89476 kPa (arredondado para inteiro)
 */
export function convertPressureToKpa(value: number, unit: 'Bar' | 'kPa' | 'PSI'): number {
  if (value <= 0) return 0;
  switch (unit) {
    case 'Bar':
      return Math.round(value * 100);
    case 'PSI':
      return Math.round(value * 6.894757);
    case 'kPa':
    default:
      return Math.round(value);
  }
}

export function formatPressureKpa(kpa: number): string {
  if (kpa <= 0) return '';
  const bar = (kpa / 100).toFixed(1).replace('.0', '');
  return `${kpa} kPa (${bar} Bar)`;
}

/**
 * Parser Determinístico de Intervalos de Anos Automotivos.
 * Exemplos:
 * - '97/99' -> { yearStart: 1997, yearEnd: 1999, isOngoing: false }
 * - '08/...' -> { yearStart: 2008, yearEnd: 2026, isOngoing: true }
 * - '.../92' -> { yearStart: 1970, yearEnd: 1992, isOngoing: false }
 * - '>12'   -> { yearStart: 2012, yearEnd: 2026, isOngoing: true }
 * - '14/21' -> { yearStart: 2014, yearEnd: 2021, isOngoing: false }
 */
export function parseYearRangeString(raw: string): YearRange | null {
  if (!raw) return null;
  const str = raw.trim();

  // Padrão >AA ou >AAAA (ex: '>12' ou '>2012')
  const gtMatch = str.match(/^>\s*(\d{2}|\d{4})$/);
  if (gtMatch) {
    const y = normalizeYearDigits(gtMatch[1]);
    return { yearStart: y, yearEnd: 2026, isOngoing: true };
  }

  // Padrão .../AA ou .../AAAA (ex: '.../92')
  const toMatch = str.match(/^\.{2,3}\s*\/\s*(\d{2}|\d{4})$/);
  if (toMatch) {
    const end = normalizeYearDigits(toMatch[1]);
    return { yearStart: 1970, yearEnd: end, isOngoing: false };
  }

  // Padrão AA/... ou AAAA/... ou AA... (ex: '08/...' ou '10...')
  const fromMatch = str.match(/^(\d{2}|\d{4})\s*(?:\/|\.)*\.{2,3}$/);
  if (fromMatch) {
    const start = normalizeYearDigits(fromMatch[1]);
    return { yearStart: start, yearEnd: 2026, isOngoing: true };
  }

  // Padrão AA/BB ou AAAA/AAAA (ex: '97/99' ou '2014/2021')
  const rangeMatch = str.match(/^(\d{2}|\d{4})\s*\/\s*(\d{2}|\d{4})$/);
  if (rangeMatch) {
    const start = normalizeYearDigits(rangeMatch[1]);
    const end = normalizeYearDigits(rangeMatch[2]);
    return { yearStart: start, yearEnd: end, isOngoing: false };
  }

  // Ano único isolado (ex: '2018' ou '18')
  const singleMatch = str.match(/^(\d{4})$/);
  if (singleMatch) {
    const y = parseInt(singleMatch[1], 10);
    return { yearStart: y, yearEnd: y, isOngoing: false };
  }

  return null;
}

export function normalizeYearDigits(digits: string): number {
  const num = parseInt(digits, 10);
  if (digits.length === 2) {
    // 50-99 -> 1950-1999; 00-49 -> 2000-2049
    return num >= 50 ? 1900 + num : 2000 + num;
  }
  return num;
}

export function formatYearRange(yr: YearRange): string {
  if (yr.isOngoing) {
    return `${yr.yearStart}/...`;
  }
  if (yr.yearStart === yr.yearEnd) {
    return `${yr.yearStart}`;
  }
  return `${yr.yearStart}/${yr.yearEnd}`;
}
