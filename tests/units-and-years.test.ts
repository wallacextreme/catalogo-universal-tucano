import { describe, expect, it } from 'bun:test';
import {
  convertPressureToKpa,
  formatPressureKpa,
  formatYearRange,
  parseYearRangeString,
} from '../src/domain/units-and-years';

describe('Unidades de Pressão e Intervalos de Anos (Gate 7)', () => {
  it('deve converter pressões Bar e PSI para kPa com precisão', () => {
    // 1.4 Bar = 140 kPa
    expect(convertPressureToKpa(1.4, 'Bar')).toBe(140);
    // 1.0 Bar = 100 kPa
    expect(convertPressureToKpa(1.0, 'Bar')).toBe(100);
    // 15 PSI = 103 kPa
    expect(convertPressureToKpa(15, 'PSI')).toBe(103);
    // Formatação
    expect(formatPressureKpa(140)).toBe('140 kPa (1.4 Bar)');
  });

  it('deve realizar parser determinístico de intervalos de anos automotivos', () => {
    // 97/99 -> 1997 a 1999
    const y1 = parseYearRangeString('97/99');
    expect(y1).toEqual({ yearStart: 1997, yearEnd: 1999, isOngoing: false });
    expect(formatYearRange(y1!)).toBe('1997/1999');

    // 08/... -> 2008 em diante (ongoing)
    const y2 = parseYearRangeString('08/...');
    expect(y2).toEqual({ yearStart: 2008, yearEnd: 2026, isOngoing: true });
    expect(formatYearRange(y2!)).toBe('2008/...');

    // .../92 -> até 1992
    const y3 = parseYearRangeString('.../92');
    expect(y3).toEqual({ yearStart: 1970, yearEnd: 1992, isOngoing: false });

    // >12 -> 2012 em diante
    const y4 = parseYearRangeString('>12');
    expect(y4).toEqual({ yearStart: 2012, yearEnd: 2026, isOngoing: true });

    // 14/21 -> 2014 a 2021
    const y5 = parseYearRangeString('14/21');
    expect(y5).toEqual({ yearStart: 2014, yearEnd: 2021, isOngoing: false });

    // 10... -> 2010 em diante
    const y6 = parseYearRangeString('10...');
    expect(y6).toEqual({ yearStart: 2010, yearEnd: 2026, isOngoing: true });
  });
});
